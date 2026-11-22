// IDXC's pure half (indexChangesModel.js). Every symbol, name and date is invented.
import { describe, it, expect } from 'vitest'
import {
  IDXC_COMPUTING_POLL_MS, IDXC_HELD_POLL_MS, IDXC_INDEX_ARG_WORDS, changeDayWords, droppedWords, idxcCommandArgs, idxcCountLine, idxcPollMs, idxcRead,
  idxcUrl, legWords, normIdxcIndex, parseIdxcIndex,
} from './indexChangesModel'

const side = (sym, name, covered = true) => ({ sym, name, covered })
const chg = (index, date, added, removed, reason = 'Market capitalization change.') => ({ index, date, added, removed, reason })
const LEGS = { sp500: { state: 'ok', http_status: null, count: 2, dropped: 0 }, nasdaq100: { state: 'ok', http_status: null, count: 1, dropped: 1 },
  dow: { state: 'not_in_plan', http_status: 403, count: 0, dropped: 0 } }
const BODY = (over = {}) => ({ status: 'ok', index: 'all', sym: null, read_at: '2031-03-12T14:02:00+00:00', source: 'Financial Modeling Prep', check: null,
  indexes: LEGS, total: 3, cut: false, changes: [
    chg('sp500', '2030-01-09', side('QQZB', 'Bramblecourt Foods'), side('QQZT', 'Tinmoor Works', false)),
    chg('sp500', '2031-03-03', side('QQZA', 'Quillfeather Mills'), side('QQZR', 'Rustbank Inc', false)),
    chg('nasdaq100', '2031-03-03', side('QQZC', 'Fernhollow'), side('QQZA', 'Quillfeather Mills')),
  ], ...over })

describe('the index word', () => {
  it('S&P500, NASDAQ100 and DOW30; the words COT owns are not IDXC\'s', () => {
    expect(IDXC_INDEX_ARG_WORDS).toEqual({ 'S&P500': 'sp500', NASDAQ100: 'nasdaq100', DOW30: 'dow' })
    expect(parseIdxcIndex('s&p500')).toBe('sp500')
    expect(parseIdxcIndex(' nasdaq100 ')).toBe('nasdaq100')
    for (const no of ['SP500', 'SPX', 'NDX', 'DOW', 'DJIA', 'ALL', '', null]) expect(parseIdxcIndex(no), String(no)).toBeNull()
    expect([normIdxcIndex('dow'), normIdxcIndex('x')]).toEqual(['dow', 'all'])
    expect(idxcCommandArgs({ index: 'nasdaq100' })).toEqual(['NASDAQ100'])
    expect(idxcCommandArgs({ index: 'sp500' })).toEqual(['S&P500'])
    expect(idxcCommandArgs({ index: 'all' })).toEqual([])
    expect(idxcUrl({})).toBe('/api/research/index-changes?index=all')
    expect(idxcUrl({ index: 'dow', sym: 'BRK.B' })).toBe('/api/research/index-changes?index=dow&sym=BRK.B')
    expect(idxcPollMs({ status: 'computing' })).toBe(IDXC_COMPUTING_POLL_MS)
    expect(idxcPollMs({ status: 'ok' })).toBe(IDXC_HELD_POLL_MS)
  })
})

describe('the read', () => {
  it('every non-answer is its own state', () => {
    for (const body of [null, [], { status: 'ok' }, { status: 'x', changes: [] }]) expect(idxcRead(body).state, JSON.stringify(body)).toBe('failed')
    expect(idxcRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(idxcRead({ status: 'failed', reason: 'source' })).toEqual({ state: 'source', reason: 'source' })
  })

  it('changes newest first; a change with no day, an unknown index or no symbol on either side is dropped and counted', () => {
    const v = idxcRead(BODY({ changes: [...BODY().changes, chg('sp500', 'soon', side('QQZD', 'D'), null), chg('russell', '2031-01-01', side('QQZE', 'E'), null),
      chg('dow', '2031-02-02', null, null)] }))
    expect(v.state).toBe('ok')
    expect(v.changes.map((c) => [c.index, c.date])).toEqual([['sp500', '2031-03-03'], ['nasdaq100', '2031-03-03'], ['sp500', '2030-01-09']])
    expect(v.dropped).toBe(3)
    expect(v.legs.dow).toEqual({ state: 'not_in_plan', count: 0, dropped: 0 })
    expect(v.symbols).toEqual(['QQZA', 'QQZC', 'QQZB'])
  })
})

describe('words', () => {
  it('the count line for all three, one index, a cut list and one stock', () => {
    expect(idxcCountLine(idxcRead(BODY()))).toBe('3 changes to the S&P 500, the Nasdaq 100 and the Dow 30, newest first.')
    expect(idxcCountLine(idxcRead(BODY({ index: 'nasdaq100' })))).toBe('3 changes to the Nasdaq 100, newest first.')
    expect(idxcCountLine(idxcRead(BODY({ total: 1200, cut: true })))).toBe('3 changes to the S&P 500, the Nasdaq 100 and the Dow 30, newest first (the newest 3 of 1,200).')
    expect(idxcCountLine(idxcRead(BODY({ sym: 'QQZA' })))).toBe('QQZA: 3 changes in the S&P 500, the Nasdaq 100 and the Dow 30, newest first.')
    expect(idxcCountLine(idxcRead(BODY({ sym: 'QQZA', changes: [] })))).toBe('QQZA has no addition or removal held for the S&P 500, the Nasdaq 100 and the Dow 30.')
    expect(changeDayWords('2031-03-03')).toBe('Mar 3, 2031')
  })

  it('each index whose read did not answer is named; dropped rows are counted', () => {
    expect(legWords(idxcRead(BODY()))).toBe('The Dow 30 list is not available from our data provider.')
    expect(legWords(idxcRead(BODY({ index: 'sp500' })))).toBe('')
    expect(legWords(idxcRead(BODY({ indexes: { ...LEGS, sp500: { state: 'failed' } } })))).toContain('The S&P 500 list could not be read just now.')
    expect(droppedWords(idxcRead(BODY()))).toBe('1 row in the provider\'s lists had no date or no symbol and is not shown.')
  })
})
