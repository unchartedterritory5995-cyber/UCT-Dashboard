// CEOS, the pure half: the typed words, the URL, the command a phrase opens, and the answer as the
// panel needs it. The fixture is the route's real shape (api/services/call_themes.py get_themes),
// with made-up tickers and phrases.
import { describe, it, expect } from 'vitest'
import {
  BOTH_ROWS, CALL_SEARCH_CODE, CALL_THEMES_CODE, CALL_THEMES_LIST_ARG_WORDS, CALL_THEMES_URL, CALL_THEME_LISTS,
  DEFAULT_CALL_THEMES_LIST, callThemesCommandArgs, callThemesRead, callThemesUrl, cleanPhrase, monthLabel, normCallThemesList,
  parseCallThemesList, parseCallThemesMonth, rowCommands, searchCommand, shownRows,
} from './callThemesModel'

const row = (phrase, over = {}) => ({
  phrase, words: phrase.split(' ').length, calls: 42, pct: 14.0, companies: 41, base_calls: 0, base_pct: 0.0, base_raw_pct: 0.0,
  rise: 14.0, ratio: null, related: [], examples: ['AAA', 'BBB', 'CCC'], ...over,
})
const OK = {
  status: 'ok',
  month: '2026-11',
  months: ['2026-11', '2026-10'],
  calls: 300,
  companies: 296,
  baseline: { months: ['2026-08', '2026-09', '2026-10'], calls: 490, matched_pct: 92.5 },
  floor: { calls: 8, companies: 6 },
  new: [
    row('government shutdown', { related: ['federal orders', 'agencies'] }),
    row('agentic commerce', { calls: 18, pct: 6.0, companies: 18, rise: 5.8, base_calls: 1, base_pct: 0.2, base_raw_pct: 0.2, ratio: 30.0, examples: ['DDD'] }),
  ],
  rising: [
    row('tariffs', { calls: 101, pct: 33.7, companies: 99, base_calls: 67, base_pct: 13.2, base_raw_pct: 13.7, rise: 20.5, ratio: 2.6, related: ['tariff impact'] }),
    row('data center', { calls: 98, pct: 32.7, companies: 97, base_calls: 96, base_pct: 18.6, base_raw_pct: 19.6, rise: 14.1, ratio: 1.8, examples: [] }),
  ],
  qualified: { new: 2, rising: 41 },
  built_at: '2026-11-17T11:52:00Z',
  refreshing: false,
  corpus: { calls: 790, oldest: '2026-08-19', newest: '2026-11-17', months: [{ month: '2026-08', calls: 110 }, { month: '2026-09', calls: 120 }, { month: '2026-10', calls: 260 }, { month: '2026-11', calls: 300 }] },
  rules: { min_month_calls: 100, min_base_calls: 100, base_months: 3, min_calls: 8, min_share_pct: 2.0, min_companies: 6, new_max_base_pct: 0.5, rise_min_points: 2.0, rise_min_ratio: 1.25, rise_min_ratio_one_word: 2.0, min_z: 3.0, list_cap: 30, max_words: 3 },
}

describe('CEOS typed words', () => {
  it('the code, the route and the three choices', () => {
    expect(CALL_THEMES_CODE).toBe('CEOS')
    expect(CALL_SEARCH_CODE).toBe('TSRC')
    expect(CALL_THEMES_URL).toBe('/api/earnings/call-themes')
    expect(Object.keys(CALL_THEME_LISTS)).toEqual(['both', 'new', 'rising'])
    expect(DEFAULT_CALL_THEMES_LIST).toBe('both')
  })

  it('a word names a list in any case, and every chip token reads back as its own list', () => {
    for (const [raw, want] of [['NEW', 'new'], ['new', 'new'], ['Fresh', 'new'], ['RISING', 'rising'], ['rise', 'rising'], ['UP', 'rising'], ['BOTH', 'both'], ['all', 'both']]) {
      expect(parseCallThemesList(raw), raw).toBe(want)
    }
    for (const bad of [null, undefined, '', 'NVDA', 'FALLING', '2026-10', 'toString', 'constructor']) expect(parseCallThemesList(bad), String(bad)).toBeNull()
    for (const [key, l] of Object.entries(CALL_THEME_LISTS)) if (l.token) expect(parseCallThemesList(l.token)).toBe(key)
    expect(new Set(Object.values(CALL_THEMES_LIST_ARG_WORDS))).toEqual(new Set(Object.keys(CALL_THEME_LISTS)))
    expect(normCallThemesList('RISING')).toBe('rising')
    expect(normCallThemesList('new')).toBe('new')
    expect(normCallThemesList(null)).toBe('both')
    expect(normCallThemesList('banana')).toBe('both')
  })

  it('a month is read as YYYY-MM and nothing else is', () => {
    expect(parseCallThemesMonth('2026-10')).toBe('2026-10')
    expect(parseCallThemesMonth('2026-9')).toBe('2026-09')
    expect(parseCallThemesMonth('2026/10')).toBe('2026-10')
    for (const bad of [null, undefined, '', 'OCT', '2026', '2026-13', '2026-00', '1999-10', '2026-10-05', '10-2026', 'NEW']) {
      expect(parseCallThemesMonth(bad), String(bad)).toBeNull()
    }
  })

  it('a choice is written as the words the command line takes; the default is the bare command', () => {
    expect(callThemesCommandArgs({})).toEqual([])
    expect(callThemesCommandArgs({ list: 'both', month: null })).toEqual([])
    expect(callThemesCommandArgs({ list: 'rising' })).toEqual(['RISING'])
    expect(callThemesCommandArgs({ list: 'new', month: '2026-10' })).toEqual(['NEW', '2026-10'])
    expect(callThemesCommandArgs({ month: '2026-9' })).toEqual(['2026-09'])
    expect(callThemesCommandArgs({ list: 'banana', month: 'soon' })).toEqual([])
  })

  it('the URL carries a month only when it is one', () => {
    expect(callThemesUrl()).toBe('/api/earnings/call-themes')
    expect(callThemesUrl('2026-10')).toBe('/api/earnings/call-themes?month=2026-10')
    expect(callThemesUrl('last month')).toBe('/api/earnings/call-themes')
  })

  it('monthLabel', () => {
    expect(monthLabel('2026-11')).toBe('Nov 2026')
    for (const bad of [null, '', '2026-13', '2026-1', 'Nov 2026']) expect(monthLabel(bad), String(bad)).toBeNull()
  })
})

describe('CEOS the command a phrase opens', () => {
  it('one word is searched as typed, several as one exact phrase', () => {
    expect(searchCommand('tariffs')).toBe('TSRC tariffs')
    expect(searchCommand('pricing power')).toBe('TSRC "pricing power"')
    expect(searchCommand('  sovereign   AI programs ')).toBe('TSRC "sovereign AI programs"')
  })

  it('only letters and numbers reach the command line', () => {
    expect(cleanPhrase('GLP-1 "users"; NVDA GP')).toBe('GLP 1 users NVDA GP')
    expect(searchCommand('"quoted" (phrase)')).toBe('TSRC "quoted phrase"')
    for (const bad of [null, undefined, '', ' ', 'x', '!!', '"']) expect(searchCommand(bad), String(bad)).toBeNull()
  })
})

describe('CEOS reading the answer', () => {
  it('a healthy answer: the month, what it was compared with, both lists and what was left out', () => {
    const v = callThemesRead(OK)
    expect(v.state).toBe('ok')
    expect([v.month, v.label, v.calls, v.companies]).toEqual(['2026-11', 'Nov 2026', 300, 296])
    expect(v.months).toEqual([{ month: '2026-11', label: 'Nov 2026' }, { month: '2026-10', label: 'Oct 2026' }])
    expect(v.baseline).toEqual({ from: 'Aug 2026', to: 'Oct 2026', calls: 490, matched: 92.5 })
    expect(v.floor).toEqual({ calls: 8, companies: 6 })
    expect(v.lists.new.rows.map((r) => r.phrase)).toEqual(['government shutdown', 'agentic commerce'])
    expect(v.lists.new).toMatchObject({ qualified: 2, cut: 0 })
    expect(v.lists.rising).toMatchObject({ qualified: 41, cut: 39 })
    expect(v.builtAt).toBe('2026-11-17T11:52:00Z')
    expect(v.refreshing).toBe(false)
    expect(v.rules.min_z).toBe(3)
    expect(v.corpus.calls).toBe(790)
    expect(v.corpus.months[3]).toEqual({ month: '2026-11', label: 'Nov 2026', calls: 300 })
  })

  it('a row keeps the numbers as sent and opens the call search on its phrase', () => {
    const [shutdown, agentic] = callThemesRead(OK).lists.new.rows
    expect(shutdown).toEqual({
      key: 'government shutdown', phrase: 'government shutdown', cmd: 'TSRC "government shutdown"', calls: 42, share: 14.0, companies: 41,
      base: 0.0, baseRaw: 0.0, baseCalls: 0, rise: 14.0, ratio: null, related: ['federal orders', 'agencies'], examples: ['AAA', 'BBB', 'CCC'],
    })
    expect([agentic.ratio, agentic.baseCalls, agentic.examples]).toEqual([30.0, 1, ['DDD']])
    const tariffs = callThemesRead(OK).lists.rising.rows[0]
    expect([tariffs.cmd, tariffs.share, tariffs.base, tariffs.baseRaw, tariffs.rise, tariffs.ratio]).toEqual(['TSRC tariffs', 33.7, 13.2, 13.7, 20.5, 2.6])
  })

  it('a missing number stays missing, never 0', () => {
    const v = callThemesRead({ ...OK, companies: null, floor: {}, baseline: { months: [] }, new: [{ phrase: 'agentic commerce', calls: 18 }] })
    const [r] = v.lists.new.rows
    expect([r.share, r.companies, r.base, r.baseRaw, r.baseCalls, r.rise, r.ratio]).toEqual([null, null, null, null, null, null, null])
    expect(r.related).toEqual([])
    expect(r.examples).toEqual([])
    expect(v.companies).toBeNull()
    expect(v.floor).toEqual({ calls: null, companies: null })
    expect(v.baseline).toEqual({ from: null, to: null, calls: null, matched: null })
  })

  it('rows that cannot be shown are dropped: no phrase, no call count, a repeat, a phrase nothing can search', () => {
    const v = callThemesRead({ ...OK, new: [row('tariffs'), row(''), row('Tariffs'), { phrase: 'no count' }, row('!'), null, row('glp', { examples: ['ok', 'AAA', 'aaa', 'not a ticker!', 7] })] })
    expect(v.lists.new.rows.map((r) => r.phrase)).toEqual(['tariffs', 'glp'])
    expect(v.lists.new.rows[1].examples).toEqual(['OK', 'AAA'])
  })

  it('each answer that is not a list is its own state', () => {
    expect(callThemesRead({ status: 'computing' }).state).toBe('computing')
    expect(callThemesRead({ status: 'error' }).state).toBe('error')
    const thin = callThemesRead({ status: 'thin', months: [], built_at: OK.built_at, corpus: { calls: 102, months: [{ month: '2026-11', calls: 62 }, { month: '2026-10', calls: 40 }] }, rules: OK.rules })
    expect([thin.state, thin.corpus.calls, thin.rules.min_month_calls]).toEqual(['thin', 102, 100])
    expect(thin.corpus.months.map((m) => m.label)).toEqual(['Nov 2026', 'Oct 2026'])
    expect(callThemesRead({ status: 'empty', months: [], corpus: { calls: 0, months: [] } }).state).toBe('empty')
    const miss = callThemesRead({ status: 'no_month', month: '2026-09', months: ['2026-11', '2026-10'], corpus: OK.corpus })
    expect([miss.state, miss.month, miss.label, miss.months.length]).toEqual(['no-month', '2026-09', 'Sep 2026', 2])
  })

  it('anything that is not this route\'s answer is failed, never an empty list', () => {
    for (const bad of [null, undefined, [], 'ok', {}, { status: 'warming' }, { status: 'toString' }, { new: [], rising: [] },
      { ...OK, month: 'November' }, { ...OK, new: null }, { ...OK, rising: 'none' }]) {
      const v = callThemesRead(bad)
      expect(v.state, JSON.stringify(bad)).toBe('failed')
      expect(v.lists.new.rows).toEqual([])
    }
  })
})

describe('CEOS what is on screen', () => {
  const many = { ...OK, new: Array.from({ length: 14 }, (_, i) => row(`theme ${String.fromCharCode(97 + i)}`)), qualified: { new: 14, rising: 41 } }

  it('both lists show the first ten of each; one list shows all of it', () => {
    expect(BOTH_ROWS).toBe(10)
    const v = callThemesRead(many)
    expect(shownRows(v.lists.new.rows, 'both')).toHaveLength(10)
    expect(shownRows(v.lists.new.rows, 'new')).toHaveLength(14)
    expect(shownRows(null, 'both')).toEqual([])
  })

  it('row numbers run down the screen: the new list, then the rising list', () => {
    const v = callThemesRead(many)
    const both = rowCommands(v, 'both')
    expect(both).toHaveLength(12)
    expect([both[0], both[9], both[10], both[11]]).toEqual(['TSRC "theme a"', 'TSRC "theme j"', 'TSRC tariffs', 'TSRC "data center"'])
    expect(rowCommands(v, 'rising')).toEqual(['TSRC tariffs', 'TSRC "data center"'])
    expect(rowCommands(v, 'new')).toHaveLength(14)
    expect(rowCommands(callThemesRead({ status: 'computing' }), 'both')).toEqual([])
    expect(rowCommands(null, 'both')).toEqual([])
  })
})
