// COT's model: the Commitments of Traders routes' answers -> the board and one market. Rails:
//   * the argument is one typed word; a word resolves only against the route's own list (code, plain
//     word, whole name, the start of exactly one name) and never guesses;
//   * the roster lists each market once (the server's shortlist repeats markets);
//   * net, week change, share of open interest and the 3-year range are the COT Data page's own
//     arithmetic; the range is shown only with its 156 reports; one report has no week change;
//   * the board sorts by the size of the week's move as a share of open interest, no figure last.
// Every number is invented; the fixtures are the routes' real shapes.
import { describe, it, expect } from 'vitest'
import { computeSnapshot } from '../../cot/cotRead'
import {
  COT_ARG_SHAPE, COT_CLASSES, COT_CODE, COT_HISTORY_ROWS, COT_RANGE_WEEKS, COT_SOURCE, COT_SYMBOLS_URL, COT_WEEKLY_LINE, COT_WEEKS, COT_WORDS,
  boardDates, boardRow, contractsText, cotCommandArgs, cotMarketRead, cotNarrativeUrl, cotNote, cotRoster, cotRows, cotUrl, groupLabel,
  marketList, noteParagraphs, parseCotArg, rangeText, rangeWhy, reportDay, resolveCotMarket, shareText, signOf, signedContracts, sortBoard,
} from './cotModel'

/** The Tuesday `back` weeks before Tue Nov 17 2026. */
const tue = (back) => new Date(Date.UTC(2026, 10, 17) - back * 7 * 86400000).toISOString().slice(0, 10)
/** `n` weekly rows, oldest first; `f(back)` gives the figures of the report `back` weeks ago. */
const weekly = (n, f) => Array.from({ length: n }, (_, i) => ({ date: tue(n - 1 - i), ...f(n - 1 - i) }))
/** 160 reports whose newest row and range are easy to read off. */
const GOLD = weekly(160, (back) => ({
  large_spec_net: back === 0 ? 180000 : back % 2 ? 100000 : 200000,     // 80 of 100 in its range, +80,000 on the week
  commercial_net: back === 0 ? -190000 : back % 2 ? -120000 : -220000,  // 30 of 100, -70,000 on the week
  small_spec_net: back === 0 ? 10000 : back % 2 ? 20000 : 0,            // 50 of 100, -10,000 on the week
  open_interest: back === 0 ? 520000 : 500000,
}))
const three = (ls, comm, oi) => weekly(3, (back) => ({
  large_spec_net: ls[2 - back], commercial_net: comm[2 - back], small_spec_net: 1000, open_interest: oi,
}))
const SYMBOLS = { groups: {
  'MOST WATCHED': [{ symbol: 'ES', name: 'S&P 500 E-mini' }, { symbol: 'ZN', name: '10-Year T-Note' }],
  INDICES: [{ symbol: 'ES', name: 'S&P 500 E-mini' }, { symbol: 'NQ', name: 'Nasdaq 100 E-mini' }],
  METALS: [{ symbol: 'GC', name: 'Gold' }, { symbol: 'SI', name: 'Silver' }],
  RATES: [{ symbol: 'ZN', name: '10-Year T-Note' }],
  ENERGIES: [{ symbol: 'CL', name: 'Crude Oil' }, { symbol: 'NG', name: 'Natural Gas' }, { symbol: 'NN', name: 'Natural Gas Penultimate' }],
} }

describe('COT constants and routes', () => {
  it('reads the COT Data page\'s routes at one depth, and never asks for a note to be written', () => {
    expect([COT_CODE, COT_WEEKS, COT_RANGE_WEEKS, COT_HISTORY_ROWS, COT_SYMBOLS_URL]).toEqual(['COT', 160, 156, 8, '/api/cot/symbols'])
    expect(cotUrl('gc')).toBe('/api/cot/GC?weeks=160')
    expect(cotUrl('S&P')).toBe('/api/cot/S%26P?weeks=160')
    expect(cotNarrativeUrl('gc')).toBe('/api/cot/GC/narratives?limit=1')
    expect(COT_SOURCE).toBe('CFTC Commitments of Traders (legacy futures-only report)')
    expect(COT_WEEKLY_LINE).toBe('Weekly. The CFTC counts positions each Tuesday and publishes them the following Friday, so every figure is about three days old on the day it comes out.')
    expect(COT_CLASSES.map((c) => [c.key, c.field, c.label])).toEqual([
      ['largeSpecs', 'large_spec_net', 'Large speculators'], ['commercials', 'commercial_net', 'Commercials'], ['smallSpecs', 'small_spec_net', 'Small speculators'],
    ])
  })
})

describe('COT the typed word', () => {
  it('is one word of letters, digits, & . -, upper-cased; anything else is not an argument', () => {
    expect([parseCotArg('gold'), parseCotArg(' ES '), parseCotArg('10y'), parseCotArg('S&P'), parseCotArg('B6'), parseCotArg('E-MINI')])
      .toEqual(['GOLD', 'ES', '10Y', 'S&P', 'B6', 'E-MINI'])
    for (const bad of ['', ' ', 'A B', '-X', '.X', 'ABCDEFGHIJKLM', 'GOLD!', '$GC', null, undefined]) expect(parseCotArg(bad), String(bad)).toBeNull()
    expect(COT_ARG_SHAPE.test('ABCDEFGHIJKL')).toBe(true)        // twelve characters is the longest word
  })

  it('every plain word is one token of the argument shape and names a market code', () => {
    const words = Object.entries(COT_WORDS)
    expect(words.length).toBe(63)
    for (const [word, code] of words) {
      expect(parseCotArg(word), word).toBe(word)
      expect(code, word).toMatch(/^[A-Z0-9]{2,4}$/)
    }
    expect([COT_WORDS.GOLD, COT_WORDS.OIL, COT_WORDS['10Y'], COT_WORDS['S&P'], COT_WORDS.DOLLAR, COT_WORDS.BITCOIN, COT_WORDS.VIX])
      .toEqual(['GC', 'CL', 'ZN', 'ES', 'DX', 'BTC', 'VI'])
  })

  it('writes the market into the command, and nothing for the board', () => {
    expect(cotCommandArgs({ market: 'gc' })).toEqual(['GC'])
    expect(cotCommandArgs({ market: '' })).toEqual([])
    expect(cotCommandArgs()).toEqual([])
  })
})

describe('COT the roster', () => {
  it('lists each market once under its own group, in the server\'s order; the shortlist stays a group', () => {
    const roster = cotRoster(SYMBOLS)
    expect(roster.state).toBe('ok')
    expect(roster.markets.map((m) => `${m.code}:${m.group}`)).toEqual(['ES:INDICES', 'NQ:INDICES', 'GC:METALS', 'SI:METALS', 'ZN:RATES', 'CL:ENERGIES', 'NG:ENERGIES', 'NN:ENERGIES'])
    expect(roster.markets[0]).toEqual({ code: 'ES', name: 'S&P 500 E-mini', group: 'INDICES' })
    expect(roster.groups.map((g) => [g.name, g.label, g.codes.join(' ')])).toEqual([
      ['MOST WATCHED', 'Most watched', 'ES ZN'], ['INDICES', 'Indices', 'ES NQ'], ['METALS', 'Metals', 'GC SI'], ['RATES', 'Rates', 'ZN'],
      ['ENERGIES', 'Energies', 'CL NG NN'],
    ])
    expect(groupLabel('LIVESTOCK & DAIRY')).toBe('Livestock & dairy')
  })

  it('a market listed only on the shortlist is kept; a row with no code is dropped; a missing name is the code', () => {
    const roster = cotRoster({ groups: { 'MOST WATCHED': [{ symbol: 'vi', name: 'VIX' }, { symbol: 'ES' }], INDICES: [{ symbol: 'ES', name: '' }, { name: 'x' }, null, { symbol: 'ES' }], EMPTY: [], ODD: 'x' } })
    expect(roster.markets).toEqual([{ code: 'ES', name: 'ES', group: 'INDICES' }, { code: 'VI', name: 'VIX', group: 'MOST WATCHED' }])
    expect(roster.groups.map((g) => g.name)).toEqual(['MOST WATCHED', 'INDICES'])
  })

  it('tells "not the route\'s answer" from "no market listed"', () => {
    for (const bad of [null, undefined, [], 'x', {}, { groups: [] }, { groups: 'x' }]) expect(cotRoster(bad).state, JSON.stringify(bad)).toBe('failed')
    expect(cotRoster({ groups: {} })).toEqual({ state: 'none', groups: [], markets: [] })
    expect(cotRoster({ groups: { METALS: [] } }).state).toBe('none')
  })
})

describe('COT resolving a word against the route\'s own list', () => {
  const { markets } = cotRoster(SYMBOLS)
  const name = (tok, list = markets) => resolveCotMarket(tok, list)?.code ?? null

  it('a code, in either case', () => {
    expect([name('GC'), name('gc'), name('zn'), name('NQ')]).toEqual(['GC', 'GC', 'ZN', 'NQ'])
  })

  it('a plain word, when the list holds its market', () => {
    expect([name('GOLD'), name('gold'), name('SILVER'), name('OIL'), name('CRUDE'), name('WTI'), name('10Y'), name('TENS'), name('S&P'), name('SPX'), name('NASDAQ'), name('NATGAS')])
      .toEqual(['GC', 'GC', 'SI', 'CL', 'CL', 'CL', 'ZN', 'ZN', 'ES', 'ES', 'NQ', 'NG'])
    // the word is known, the list does not hold that market: no guess
    expect([name('COPPER'), name('BITCOIN'), name('DOLLAR')]).toEqual([null, null, null])
  })

  it('a whole name, or the start of exactly one name', () => {
    expect(name('CRUDEOIL')).toBe('CL')                 // punctuation and spaces are ignored
    expect(name('SILV')).toBe('SI')
    expect(name('NASD')).toBe('NQ')
    expect(name('NATURALGAS')).toBe('NG')               // a whole name wins over being the start of another
    expect(name('NATURAL')).toBeNull()                  // the start of two names: no guess
    expect(name('SI')).toBe('SI')                       // a code comes before any name
    expect(name('GO')).toBeNull()                       // two letters are too few to match a name by its start
  })

  it('a code wins over a plain word with the same spelling', () => {
    const list = [...markets, { code: 'GOLD', name: 'A market whose code is a word', group: 'METALS' }]
    expect(name('GOLD', list)).toBe('GOLD')
  })

  it('nothing resolves without a word or without a list', () => {
    expect([name(''), name(null), name('ZZZ'), name('A B'), name('GC', []), name('GC', null)]).toEqual([null, null, null, null, null, null])
  })
})

describe('COT words', () => {
  it('contracts are compact; a net carries its sign and never a dash for zero', () => {
    expect([contractsText(1250000), contractsText(212400), contractsText(10000), contractsText(9500), contractsText(860), contractsText(-85100), contractsText(null)])
      .toEqual(['1.25M', '212.4K', '10.0K', '9,500', '860', '85.1K', 'n/a'])
    expect([signedContracts(212400), signedContracts(-85100), signedContracts(8200), signedContracts(-1250000), signedContracts(0), signedContracts(0.3), signedContracts(undefined)])
      .toEqual(['+212.4K', '-85.1K', '+8,200', '-1.25M', '0', '0', 'n/a'])
  })

  it('a share and a range read plainly; the sign is the number\'s', () => {
    expect([shareText(2.14), shareText(-0.44), shareText(0.04), shareText(-0.04), shareText(15.38), shareText(null)]).toEqual(['+2.1%', '-0.4%', '0.0%', '0.0%', '+15.4%', 'n/a'])
    expect([rangeText(79.6), rangeText(0), rangeText(100), rangeText(null)]).toEqual(['80', '0', '100', 'n/a'])
    expect([signOf(3), signOf(-3), signOf(0), signOf(null), signOf('3')]).toEqual(['up', 'down', 'flat', null, null])
    expect(reportDay('2026-11-17')).toBe('Tue Nov 17, 2026')
    expect(reportDay('nope')).toBe('an unknown day')
    expect(rangeWhy(3)).toBe('The 3-year range needs 156 weekly reports; 3 are stored.')
    expect(rangeWhy(1)).toBe('The 3-year range needs 156 weekly reports; 1 is stored.')
  })
})

describe('COT one market', () => {
  it('tells a failed read, no stored report and an answer apart', () => {
    for (const bad of [null, undefined, {}, 'x', { rows: [] }]) expect(cotMarketRead(bad).state, JSON.stringify(bad)).toBe('failed')
    expect(cotMarketRead([]).state).toBe('none')
    expect(cotMarketRead([{ date: '2026-11-17', large_spec_net: null }]).state).toBe('none')      // no usable row
    expect(cotMarketRead(GOLD).state).toBe('ok')
  })

  it('the rows are read oldest first whatever order they arrive in, and a row missing a figure is dropped', () => {
    const rows = cotRows([GOLD[159], GOLD[157], { date: '2026-11-03', large_spec_net: 1, commercial_net: 2, small_spec_net: 3 }, 'x', GOLD[158], { ...GOLD[0], date: 'nope' }])
    expect(rows.map((r) => r.date)).toEqual([tue(2), tue(1), tue(0)])
    expect(cotRows({ rows: [] })).toBeNull()
  })

  it('each class: net, the week\'s change, its share of open interest and its place in the 3-year range', () => {
    const view = cotMarketRead(GOLD)
    expect([view.date, view.weeks, view.rangeOk]).toEqual(['2026-11-17', 160, true])
    const by = Object.fromEntries(view.classes.map((c) => [c.key, c]))
    expect(view.classes.map((c) => c.label)).toEqual(['Large speculators', 'Commercials', 'Small speculators'])
    expect([by.largeSpecs.net, by.largeSpecs.wow]).toEqual([180000, 80000])
    expect([by.commercials.net, by.commercials.wow]).toEqual([-190000, -70000])
    expect([by.smallSpecs.net, by.smallSpecs.wow]).toEqual([10000, -10000])
    expect(by.largeSpecs.range).toBeCloseTo(80, 8)
    expect(by.commercials.range).toBeCloseTo(30, 8)
    expect(by.smallSpecs.range).toBeCloseTo(50, 8)
    expect(by.largeSpecs.pctOi).toBeCloseTo((180000 / 520000) * 100, 10)
    expect(view.oi).toEqual({ value: 520000, wow: 20000 })
  })

  it('is the COT Data page\'s own arithmetic, not a second formula', () => {
    const snap = computeSnapshot(GOLD, GOLD.length - 1)
    const view = cotMarketRead(GOLD)
    for (const c of view.classes) {
      expect([c.net, c.wow, c.pctOi, c.range], c.key).toEqual([snap.groups[c.key].net, snap.groups[c.key].wow, snap.groups[c.key].pctOi, snap.groups[c.key].index])
    }
  })

  it('fewer than 156 reports has no range; one report has no week change either: neither is a 0', () => {
    const short = cotMarketRead(GOLD.slice(-155))
    expect([short.weeks, short.rangeOk]).toEqual([155, false])
    expect(short.classes.map((c) => c.range)).toEqual([null, null, null])
    expect(short.classes[0].wow).toBe(80000)
    expect(cotMarketRead(GOLD.slice(-156)).classes[0].range).toBeCloseTo(80, 8)
    const one = cotMarketRead(GOLD.slice(-1))
    expect(one.classes.map((c) => c.wow)).toEqual([null, null, null])
    expect(one.oi).toEqual({ value: 520000, wow: null })
    expect(one.history).toHaveLength(1)
  })

  it('the history is the newest eight reports, newest first', () => {
    const { history } = cotMarketRead(GOLD)
    expect(history.map((h) => h.date)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(tue))
    expect(history[0]).toEqual({ date: '2026-11-17', largeSpecs: 180000, commercials: -190000, smallSpecs: 10000, oi: 520000 })
    expect(history[1]).toEqual({ date: '2026-11-10', largeSpecs: 100000, commercials: -120000, smallSpecs: 20000, oi: 500000 })
    expect(cotMarketRead(GOLD.slice(-3)).history).toHaveLength(3)
  })
})

describe('COT the stored note', () => {
  it('is the newest stored row with words, with its own report date', () => {
    expect(cotNote({ symbol: 'GC', rows: [{ report_date: '2026-11-17', text: ' Speculators added.\n\nHedgers sold. ', created_at: 'x' }, { report_date: '2026-11-10', text: 'Older.' }] }))
      .toEqual({ reportDate: '2026-11-17', text: 'Speculators added.\n\nHedgers sold.' })
    expect(cotNote({ rows: [{ report_date: '2026-11-17', text: '  ' }, { report_date: 'odd', text: 'Kept.' }] })).toEqual({ reportDate: null, text: 'Kept.' })
    for (const none of [null, {}, { rows: [] }, { rows: 'x' }, []]) expect(cotNote(none), JSON.stringify(none)).toBeNull()
  })

  it('blank lines split it into paragraphs; nothing else is read into it', () => {
    expect(noteParagraphs('One  line\nstill one.\n\n\nTwo.\n \nThree.')).toEqual(['One line still one.', 'Two.', 'Three.'])
    expect(noteParagraphs('')).toEqual([])
  })
})

describe('COT the board', () => {
  const GC = { code: 'GC', name: 'Gold', group: 'METALS' }
  const CL = { code: 'CL', name: 'Crude Oil', group: 'ENERGIES' }
  const ES = { code: 'ES', name: 'S&P 500 E-mini', group: 'INDICES' }
  const ZN = { code: 'ZN', name: '10-Year T-Note', group: 'RATES' }

  it('one row per market: both nets, the week\'s move as a share of open interest, the range when it has its reports', () => {
    const row = boardRow(GC, GOLD)
    expect(row).toMatchObject({ code: 'GC', name: 'Gold', group: 'METALS', date: '2026-11-17', weeks: 160,
      largeSpecs: { net: 180000, wow: 80000 }, commercials: { net: -190000, wow: -70000 } })
    expect(row.range).toBeCloseTo(80, 8)
    expect(row.move).toBeCloseTo((80000 / 520000) * 100, 10)
    const short = boardRow(CL, three([90000, 60000, 20000], [-80000, -50000, -10000], 500000))
    expect(short.move).toBeCloseTo(-8, 8)
    expect([short.range, short.weeks]).toEqual([null, 3])
  })

  it('a market with no stored report is no row; one report has no move, never a 0', () => {
    expect(boardRow(ES, [])).toBeNull()
    expect(boardRow(ES, { detail: 'x' })).toBeNull()
    const one = boardRow(ZN, GOLD.slice(-1))
    expect(one.move).toBeNull()
    expect(one.largeSpecs).toEqual({ net: 180000, wow: null })
  })

  it('sorts by the size of the move in either direction, a market with no move last, ties by code', () => {
    const rows = [
      { code: 'ES', move: -0.2 }, { code: 'ZN', move: null }, { code: 'GC', move: 15.4 }, { code: 'CL', move: -8 }, { code: 'SI', move: 0 },
      { code: 'NQ', move: 2 }, { code: 'AA', move: null }, { code: 'BB', move: -2 },
    ]
    expect(sortBoard(rows).map((r) => r.code)).toEqual(['GC', 'CL', 'BB', 'NQ', 'ES', 'SI', 'AA', 'ZN'])
    expect(rows[0].code).toBe('ES')                     // the input is not reordered
  })

  it('names the newest report date and the markets that are behind it', () => {
    const rows = [{ code: 'GC', name: 'Gold', date: '2026-11-17' }, { code: 'CC', name: 'Cocoa', date: '2026-11-10' }, { code: 'LB', name: 'Lumber', date: '2026-11-03' }]
    const dates = boardDates(rows)
    expect(dates.latest).toBe('2026-11-17')
    expect(dates.behind.map((r) => r.code)).toEqual(['CC', 'LB'])
    expect(boardDates([])).toEqual({ latest: null, behind: [] })
    expect(marketList(dates.behind)).toBe('Cocoa (CC) and Lumber (LB)')
    expect(marketList(rows)).toBe('Gold (GC), Cocoa (CC) and Lumber (LB)')
    expect(marketList([rows[0]])).toBe('Gold (GC)')
  })
})
