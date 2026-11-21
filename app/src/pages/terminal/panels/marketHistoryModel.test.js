// MKTH's pure half: the market history answer read into the panel's view and put into words.
// Every value is invented (__fixtures__/marketHistoryFixture.js); the shape is the route's.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  CHECK_NOTE, COMPUTING_POLL_MS, HELD_POLL_MS, LEADER_SESSIONS, MKTH_CODE, MKTH_DEFAULT_INDEX, MKTH_INDEX_WORDS, MKTH_INDEXES,
  MKTH_URL, RALLY_MONTHS, SURVIVORSHIP_NOTE, changeText, indexLabel, isComputing, kindText, leadersText, levelText,
  mkthCommandArgs, mkthRead, normMkthIndex, parseMkthIndex, pointsText, rallyCell, recoveryCell, sectorsText, sessionsText,
  signOf, spanText, storeLine, summaryLine,
} from './marketHistoryModel'
import { firstStageAnswer, marketHistoryAnswer } from './__fixtures__/marketHistoryFixture'

const view = (over) => mkthRead(marketHistoryAnswer(over))
const PY = () => fs.readFileSync(path.join(process.cwd(), '..', 'api', 'services', 'market_history_calc.py'), 'utf8').replace(/\r\n/g, '\n')
/** One `NAME = value` line of the server's constants. */
const pyConst = (name) => new RegExp(`^${name} = .*$`, 'm').exec(PY())?.[0]

describe('the code, the route and the index words', () => {
  it('names the code and the one route, and its poll paces', () => {
    expect(MKTH_CODE).toBe('MKTH')
    expect(MKTH_URL).toBe('/api/research/market-history')
    expect(HELD_POLL_MS).toBe(1800000)
    expect(COMPUTING_POLL_MS).toBeLessThan(10000)
    expect(MKTH_INDEXES.map((i) => [i.key, i.label])).toEqual([['SPX', 'S&P 500'], ['NDX', 'Nasdaq-100']])
    expect(indexLabel('NDX')).toBe('Nasdaq-100')
  })

  it('reads an index word, any case, and nothing else', () => {
    for (const [w, k] of [['spx', 'SPX'], ['SP500', 'SPX'], ['spy', 'SPX'], ['NDX', 'NDX'], ['nasdaq', 'NDX'], ['nas100', 'NDX'], [' qqq ', 'NDX']]) {
      expect(parseMkthIndex(w), w).toBe(k)
    }
    for (const no of ['', 'DJX', 'RUT', 'COMP', 'IXIC', 'S&P', 'NASDAQCOMP', null, undefined]) expect(parseMkthIndex(no), String(no)).toBeNull()
    expect(Object.values(MKTH_INDEX_WORDS).every((v) => v === 'SPX' || v === 'NDX')).toBe(true)
    expect(normMkthIndex('junk')).toBe(MKTH_DEFAULT_INDEX)
    expect(mkthCommandArgs({ index: 'SPX' })).toEqual([])
    expect(mkthCommandArgs({ index: 'qqq' })).toEqual(['NDX'])
    expect(mkthCommandArgs({})).toEqual([])
  })

  it('the windows and the survivorship sentence are the server\'s, word for word', () => {
    expect(pyConst('RALLY_MONTHS')).toBe('RALLY_MONTHS = (1, 3, 6, 12)')
    expect([...RALLY_MONTHS]).toEqual([1, 3, 6, 12])
    expect(pyConst('LEADER_SESSIONS')).toBe(`LEADER_SESSIONS = ${LEADER_SESSIONS}`)
    const py = PY()
    const at = py.indexOf('SURVIVORSHIP_NOTE = (')
    const block = py.slice(at, py.indexOf(')\n', at))
    expect(at).toBeGreaterThan(0)
    const joined = [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('')
    expect(joined).toBe(SURVIVORSHIP_NOTE)
    expect(SURVIVORSHIP_NOTE).toBe("From stocks that trade today: companies later delisted or acquired are not in UCT's price history, so this list can leave out some of that rally's leaders.")
  })
})

describe('mkthRead', () => {
  it('tells a failed read, a first build, an unavailable answer and a whole one apart', () => {
    for (const b of [null, [], 'x', { status: 'ok' }, { status: 'ok', indexes: [] }, { status: 'weird', indexes: {} }]) {
      expect(mkthRead(b).state, JSON.stringify(b)).toBe('failed')
    }
    expect(mkthRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(mkthRead({ status: 'unavailable', indexes: {}, leaders: {} })).toMatchObject({ state: 'unavailable', reason: 'not_held' })
    expect(mkthRead({ status: 'unavailable', reason: 'failed', detail: 'x' })).toEqual({ state: 'unavailable', reason: 'failed', detail: 'x' })
    const v = view()
    expect(v.state).toBe('ok')
    expect(v.dataThrough).toBe('2035-10-15')
    expect(v.indexes.SPX.episodes).toHaveLength(3)
    expect(v.indexes.NDX.episodes).toHaveLength(1)
    expect(v.leaders).toMatchObject({ state: 'ok', symbols: 3512, read: 3488, notHeld: 24, storeFirst: '2030-01-02' })
  })

  it('keeps the newest-first order, and a missing number is null, never 0', () => {
    const v = view()
    expect(v.indexes.SPX.episodes.map((e) => e.trough.date)).toEqual(['2035-09-04', '2033-06-10', '2031-05-20'])
    const ongoing = v.indexes.SPX.episodes[0]
    expect(ongoing).toMatchObject({ ongoing: true, recovered: null, sessionsToRecover: null, belowNowPct: -6.42 })
    expect(ongoing.rally.map((r) => r.returnPct)).toEqual([4.1, null, null, null])
    const a = marketHistoryAnswer()
    a.indexes.SPX.episodes[1] = { ...a.indexes.SPX.episodes[1], depth_pct: 'x', sessions_down: -3, sessions_to_recover: 2.5 }
    const e = mkthRead(a).indexes.SPX.episodes[1]
    expect([e.depthPct, e.sessionsDown, e.sessionsToRecover]).toEqual([null, null, null])
  })

  it('drops an episode it cannot read, and reads an index the server does not hold in words', () => {
    const a = marketHistoryAnswer()
    a.indexes.SPX.episodes = [{ kind: 'slump' }, null, ...a.indexes.SPX.episodes]
    a.indexes.NDX = { symbol: 'NDX', name: 'Nasdaq-100', state: 'not_held', detail: 'UCT does not hold the Nasdaq-100\'s daily closes on this server yet.' }
    const v = mkthRead(a)
    expect(v.indexes.SPX.episodes).toHaveLength(3)
    expect(v.indexes.NDX).toMatchObject({ state: 'not_held', name: 'Nasdaq-100', episodes: [] })
    expect(v.indexes.NDX.detail).toContain('does not hold')
    const missing = mkthRead({ ...marketHistoryAnswer(), indexes: { SPX: marketHistoryAnswer().indexes.SPX } })
    expect(missing.indexes.NDX.state).toBe('not_held')
  })

  it('the first stage reads every list as still being worked out, and the panel asks sooner', () => {
    const v = mkthRead(firstStageAnswer())
    expect(v.leaders.state).toBe('computing')
    expect(v.indexes.SPX.episodes.every((e) => e.leaders.state === 'computing')).toBe(true)
    expect(isComputing(v)).toBe(true)
    expect(isComputing(view())).toBe(false)
    expect(isComputing({ state: 'computing' })).toBe(true)
    expect(isComputing({ state: 'failed' })).toBe(false)
  })

  it('a second stage that failed reads every list as failed, never as still working', () => {
    const a = firstStageAnswer()
    a.leaders = { state: 'failed', note: SURVIVORSHIP_NOTE }
    const v = mkthRead(a)
    expect(v.leaders.state).toBe('failed')
    expect(v.indexes.SPX.episodes.every((e) => e.leaders.state === 'failed' && e.leaders.note === SURVIVORSHIP_NOTE)).toBe(true)
    expect(isComputing(v)).toBe(false)
    expect(leadersText(v.indexes.SPX.episodes[0].leaders, 'S&P 500')).toBe(
      'The leaders could not be worked out just now. The server tries again on its own a little later.')
  })

  it('reads a leaders list, its sectors and its flags', () => {
    const ld = view().indexes.SPX.episodes[1].leaders
    expect(ld).toMatchObject({ state: 'ok', trough: '2033-06-10', end: '2033-09-09', pricedBoth: 2844, indexReturnPct: 21.4, noSector: 71 })
    expect(ld.top).toHaveLength(25)
    expect(ld.top[0]).toEqual({ sym: 'QZAA', sector: 'Technology', returnPct: 188.4, vsIndexPct: 167, check: false })
    expect(ld.top[2].check).toBe(true)
    expect(ld.top[4].sector).toBeNull()
    expect(ld.sectors[0]).toEqual({ sector: 'Technology', medianPct: 31.6, count: 412 })
    expect(ld.note).toBe(SURVIVORSHIP_NOTE)
  })
})

describe('words', () => {
  it('formats changes, levels, sessions and points through the shared formatters', () => {
    expect(changeText(39.94)).toBe('+39.9%')
    expect(changeText(-33.92)).toBe('-33.9%')
    expect(changeText(null)).toBe('n/a')
    expect(changeText(undefined, '')).toBe('')
    expect(levelText(4471.85)).toBe('4,471.85')
    expect(levelText(null)).toBe('n/a')
    expect(sessionsText(1)).toBe('1 session')
    expect(sessionsText(1940)).toBe('1,940 sessions')
    expect(sessionsText(null)).toBe('n/a')
    expect(pointsText(167)).toBe('+167.0 pts')
    expect(pointsText(-4.04)).toBe('-4.0 pts')
    expect(pointsText(-0.04)).toBe('0.0 pts')
    expect(pointsText(null)).toBe('n/a')
    expect([signOf(2), signOf(-1), signOf(0), signOf(null)]).toEqual(['up', 'down', null, null])
    expect(kindText('bear')).toBe('Bear market')
    expect(kindText('correction')).toBe('Correction')
  })

  it('the row: its span, its recovery and its rally windows', () => {
    const [ongoing, bear] = view().indexes.SPX.episodes
    expect(spanText(bear)).toBe('Feb 14, 2033 to Jun 10, 2033')
    expect(recoveryCell(bear)).toEqual({ main: 'Mar 21, 2034', sub: '194 sessions from the low' })
    expect(recoveryCell(ongoing)).toEqual({ main: 'Not yet', sub: 'now -6.4% from the peak' })
    expect(rallyCell(bear, 3)).toEqual({ months: 3, label: '3 months', kind: 'value', text: '+21.4%', sign: 'up', date: '2033-09-12' })
    expect(rallyCell(ongoing, 6)).toEqual({ months: 6, label: '6 months', kind: 'notyet', text: 'not yet', sign: null, date: null })
    expect(rallyCell(view().indexes.SPX.episodes[2], 6).sign).toBe('down')
    expect(rallyCell(bear, 1).label).toBe('1 month')
  })

  it('the summary line counts and medians, with the ongoing one said', () => {
    expect(summaryLine(view().indexes.SPX)).toBe(
      '2 corrections and 1 bear market in the S&P 500 since Jan 2, 2030. Median depth -12.0%; median recovery 127 sessions from the low (2 recovered). One is still below the peak.')
    expect(summaryLine(view().indexes.NDX)).toBe(
      '1 correction and 0 bear markets in the Nasdaq-100 since Nov 6, 2034. Median depth -11.2%; median recovery 48 sessions from the low (1 recovered).')
    const none = { name: 'S&P 500', summary: { since: '2030-01-02', corrections: 0, bearMarkets: 0, ongoing: 0, recovered: 0, medianDepthPct: null, medianRecoverySessions: null } }
    expect(summaryLine(none)).toBe('No decline of 10% or more in the S&P 500 since Jan 2, 2030 in the history UCT holds.')
    const open = { name: 'S&P 500', summary: { since: null, corrections: 1, bearMarkets: 2, ongoing: 2, recovered: 0, medianDepthPct: -21.5, medianRecoverySessions: null } }
    expect(summaryLine(open)).toBe('1 correction and 2 bear markets in the S&P 500. Median depth -21.5%; none has recovered yet. 2 are still below the peak.')
  })

  it('every leaders state is said in words, and the list says what it is measured against', () => {
    const eps = view().indexes.SPX.episodes
    expect(leadersText(eps[1].leaders, 'S&P 500')).toBe(
      'The 25 stocks that rose most in the 63 sessions after the low (Jun 10, 2033 to Sep 9, 2033), from 2,844 stocks priced on both days. The S&P 500 over the same days: +21.4%.')
    expect(leadersText(eps[0].leaders, 'S&P 500')).toBe('Not yet: 63 sessions have not passed since this low (29 sessions so far).')
    expect(leadersText(eps[2].leaders, 'S&P 500')).toBe("Too few stocks in UCT's price history at this low to list leaders: 58 priced on both days.")
    expect(leadersText({ state: 'computing' }, 'S&P 500')).toBe('The leaders of this rally are being worked out on the server. This fills in on its own.')
    expect(leadersText({ state: 'missing' }, 'S&P 500')).toBe('The leaders of this rally are not in the answer.')
    expect(sectorsText(eps[1].leaders)).toBe("Each sector's median return over the same days, from every stock priced on both days. 71 stocks with no sector held are left out.")
    expect(sectorsText({ sectors: [], noSector: 3 })).toBe('No sector is held for these stocks.')
    expect(CHECK_NOTE).toContain('more than 40% in one session')
  })

  it('the store line says how far the stock history reaches and how many stocks have one', () => {
    expect(storeLine(view())).toBe("Leaders come from UCT's stock universe ($300M market value and up), less the funds it lists. UCT's stock price history reaches back to Jan 2, 2030; 3,488 of 3,512 stocks in the universe have one.")
    expect(storeLine(mkthRead(firstStageAnswer()))).toBeNull()
  })
})
