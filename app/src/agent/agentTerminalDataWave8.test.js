// Terminal data wave 8 — three LOCAL-ONLY capabilities over three model-isolated kinds (MD-1 §4.17):
//   stock.splitsDividends ← stock.corporateActions · stock.ipoCalendar ← calendar.ipos · stock.dividendsCalendar ← calendar.dividends.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date (the newest event of the corporate actions record) or, for the two forward calendars, that the data has none
// and when UCT read it, never calls a missing number 0, says when a list is cut and from which end, never calls "not held" or
// a failed read "none", never names a vendor, and never echoes an envelope note.
// Routing: the three share ONE words-only group of their own (`marketCalendars`, the 50th of the 56 the server keeps). Each
// capability's own words are armed only while it is registered, and they never name another capability's language: the
// board's split screen and a chart's cells, a chart's split / dividend / IPO markers and its "since IPO" range, LEAD's new
// listings ("recent IPOs"), a dividend yield and other screens, the member's own lists, news of a split, the earnings calendar,
// alerts, navigation, and what a term means.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, groupOfAction, routeManifest, selectGroups, wordsSelect } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { allPhrasings } from './qa/capabilityRegression/testing/corpus'
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'
import handshake from './__fixtures__/program/isolation.json'
import { CACT_ROWS_SHOWN } from '../pages/terminal/panels/corporateActionsModel'
import { ipoWindow } from '../pages/terminal/panels/ipoCalendarModel'
import { DVD_SYMBOL_CAP } from '../pages/terminal/panels/dividendCalendarModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetCotForTest } from './capabilities/cot'
import { _resetHistoryForTest } from './capabilities/history'
import { _resetDescribeForTest } from './capabilities/chartDescribe'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS } from './capabilities/terminalDataWave3'
import { _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS, ROUTE_GROUP as WAVE4_GROUP } from './capabilities/terminalDataWave4'
import { _resetTerminalWave5ForTest, WAVE5_ROUTE_WORDS, ROUTE_GROUP as WAVE5_GROUP } from './capabilities/terminalDataWave5'
import { _resetTerminalWave6ForTest, WAVE6_ROUTE_WORDS, ROUTE_GROUP as WAVE6_GROUP } from './capabilities/terminalDataWave6'
import { _resetTerminalWave7ForTest, WAVE7_ROUTE_WORDS, ROUTE_GROUP as WAVE7_GROUP } from './capabilities/terminalDataWave7'
import {
  KINDS, CAPABILITIES, NOT_ADVICE, ACTIONS_DEFAULT_ROWS, ACTIONS_MAX_ROWS, ACTIONS_RECORD, ACTIONS_SOURCE, ACTIONS_NOT_PROOF, IPO_DEFAULT_ROWS, IPO_MAX_ROWS,
  IPO_RECORD, IPO_SOURCE_LINE, IPO_VALUE_WORDS, DIVIDENDS_MAX_SYMBOLS, DIVIDENDS_RECORD, DIVIDENDS_SOURCE_LINE, DIVIDEND_STATES,
  answerFromActions, answerFromIpos, answerFromDividends, registerTerminalWave8Capabilities, _resetTerminalWave8ForTest, WAVE8_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave8'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([\\s\\S]+?)\\)$`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const pyKind = (src) => /^KIND = "([\w.]+)"/m.exec(src)[1]
const FETCHED = '2026-11-19T15:30:00Z'               // 10:30 AM ET, a Thursday: the day of the read
const READ_AT = '2026-11-19T14:05:00Z'               // 9:05 AM ET, the same day
const NOTE = 'a provider note that must never be echoed 987654'
const plain = (o) => Object.keys(o).filter(k => k !== 'isolated')
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2026-11-18T21:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
/** the vendors' names: the panels name them, an answer never does */
const VENDORS = /\b(?:massive|polygon|finnhub|fmp|financial modeling prep|yahoo)\b/i
/** every answer of this wave: no live / now wording, never an envelope note, never a vendor's name, and never the day of the
 *  read as the data's date (the read time is printed as a time of day; the day of the read, Nov 19, appears nowhere) */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(VENDORS)
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Nov 19|2026-11-19/i)
  return a
}

// ── stock.corporateActions → stock.splitsDividends ─────────────────────────────────────────────────────────────────────
const split = (date, ratio, toFactor) => ({ date, ratio, to_factor: toFactor, isolated: true })
const div = (date, amount) => ({ date, amount, isolated: true })
const SPLITS = () => [split('2019-05-14', '3:2', 1.5), split('2011-03-02', '1:4', 0.25)]
const DIVS = () => [div('2026-08-14', 0.1375), div('2026-05-15', 0.13)]
const actionsEnv = (over = {}, envOver = {}, blocks = {}) => envelope(KINDS.actions, {
  symbol: 'ZZA', state: 'ok',
  splits: { rows: SPLITS(), count: 2, total: 2, cut: false, window_years: 45, as_of: '2019-05-14', isolated: true, ...blocks.splits },
  dividends: { rows: DIVS(), count: 2, total: 2, cut: false, window_years: 5, as_of: '2026-08-14', basis: 'split_adjusted', isolated: true, ...blocks.dividends },
  as_of: '2026-08-14', read_at: READ_AT, left_out: ['names'], ...over,
}, { as_of: '2026-08-14T04:00:00Z', ...envOver })
const ACTIONS_NAMES = "The company's name and ticker record (its former tickers) is not in this answer: the Corporate actions panel (CACT) in UCT reads it separately."
const ACTIONS_AS_OF = "The newest event in the record is Fri, Aug 14, 2026: the record's own date, never the time of this answer."
const ACTIONS_READ = "UCT read the record from its vendor at 9:05 AM ET (UCT's own time)."

describe('stock.splitsDividends — the answer', () => {
  it('each block newest first with its own window and count, the dividends split-adjusted, and the record\'s own date', () => {
    const a = honest(answerFromActions(actionsEnv(), 'ZZA'))
    expect(a.text.split('\n')).toEqual([
      "ZZA's splits and cash dividends as UCT holds them beside its chart, newest first:",
      'Splits in the last 45 years, 2 held:',
      '• May 14, 2019: 3 for 2',
      '• Mar 2, 2011: 1 for 4 (reverse split)',
      'Cash dividends by ex-date in the last 5 years, 2 held, per share and split-adjusted (what the chart draws), not the amounts as declared:',
      '• Aug 14, 2026: $0.1375',
      '• May 15, 2026: $0.13',
      ACTIONS_NAMES,
      ACTIONS_AS_OF,
      ACTIONS_READ,
      ACTIONS_SOURCE,
    ])
    expect(a.facts).toMatchObject({ symbol: 'ZZA', as_of: '2026-08-14', day: 'Fri, Aug 14, 2026', read: '9:05 AM ET', stale: false, left_out: ['names'] })
    expect(a.facts.splits).toMatchObject({ count: 2, total: 2, cut: false, years: 45, as_of: '2019-05-14' })
    expect(a.facts.dividends).toMatchObject({ count: 2, total: 2, cut: false, years: 5, as_of: '2026-08-14', basis: 'split_adjusted' })
    expect(a.facts.splits.rows[1]).toEqual({ date: '2011-03-02', ratio: '1:4', to_factor: 0.25 })
    expect(a.table.rows).toEqual([
      { kind: 'Split', date: 'May 14, 2019', detail: '3 for 2' }, { kind: 'Split', date: 'Mar 2, 2011', detail: '1 for 4 (reverse split)' },
      { kind: 'Cash dividend', date: 'Aug 14, 2026', detail: '$0.1375, split-adjusted' }, { kind: 'Cash dividend', date: 'May 15, 2026', detail: '$0.13, split-adjusted' },
    ])
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'ZZA corporate actions' })
    expect(ACTIONS_RECORD).toBe(`A record, ${NOT_ADVICE}.`)
    expect(ACTIONS_SOURCE).toBe(`Source: UCT's record beside the stock's chart, from its market-data vendor's reference data. ${ACTIONS_RECORD}`)
  })
  it('an empty block is what the held record lists, never proof of none; with neither block there is no date', () => {
    const one = honest(answerFromActions(actionsEnv({}, {}, { dividends: { rows: [], count: 0, total: 0, as_of: null } }), 'ZZA'))
    expect(one.text.split('\n')).toContain(`No cash dividend is listed in the last 5 years of the record: ${ACTIONS_NOT_PROOF}.`)
    expect(one.text).not.toMatch(/\$0\.00|Cash dividends by ex-date/)
    const none = honest(answerFromActions(actionsEnv({ as_of: null }, { as_of: null }, { splits: { rows: [], count: 0, total: 0, as_of: null }, dividends: { rows: [], count: 0, total: 0, as_of: null } }), 'ZZA'))
    expect(none.text.split('\n')).toEqual([
      `The record UCT holds beside ZZA's chart lists no split in the last 45 years and no cash dividend in the last 5 years: ${ACTIONS_NOT_PROOF}.`,
      ACTIONS_NAMES,
      ACTIONS_READ,
      ACTIONS_SOURCE,
    ])
    expect(none.table).toBeUndefined()
    expect(ACTIONS_NOT_PROOF).toMatch(/not proof that none happened$/)
  })
  it('a cut block says so and from which end; more than five rows go to the table; a ratio the record cannot state is never 0', () => {
    const many = Array.from({ length: 7 }, (_, i) => div(`2026-0${8 - i}-14`, 0.1))
    const a = honest(answerFromActions(actionsEnv({}, {}, { splits: { rows: [split('2019-05-14', null, null), ...SPLITS().slice(1)], total: 4, cut: true }, dividends: { rows: many, count: 7, total: 20, cut: true } }), 'ZZA'))
    const lines = a.text.split('\n')
    expect(lines).toContain('• May 14, 2019: ratio not stated')
    expect(lines).toContain('2 more are in the table.')
    expect(lines).toContain('4 splits are held and the newest 2 are in this answer: the list is cut from the old end.')
    expect(lines).toContain('20 cash dividends are held and the newest 7 are in this answer: the list is cut from the old end.')
    expect(lines).toContain('1 split has no ratio the record can state: it is not stated, and that is not a ratio of 0.')
    expect(a.text).not.toMatch(/0 for|: 0\b/)
    expect(a.facts.splits).toMatchObject({ count: 2, total: 4, cut: true })
    expect(a.table.rows.find(r => r.date === 'May 14, 2019').detail).toBe('not given')
  })
  it('an old record is said as stale and never refreshed; a record with no read time says it cannot say how old it is', () => {
    const stale = honest(answerFromActions(actionsEnv({ read_at: '2026-11-15T14:05:00Z' }, { stale: true }), 'ZZA'))
    expect(stale.text).toContain("UCT read the record from its vendor at Sun, Nov 15, 9:05 AM ET (UCT's own time).")
    expect(stale.text).toContain("Stale: the record is older than the chart refreshes it, so a newer split or dividend may not be in it. This answer never refreshes it: opening the stock's chart in UCT does.")
    const bare = honest(answerFromActions(actionsEnv({ read_at: null }, { stale: true }), 'ZZA'))
    expect(bare.text).toContain('The record carries no time UCT read it, so I cannot say how old it is.')
    expect(bare.text).not.toMatch(/10:30 AM|Stale:/)                    // never the time of the read in its place
  })
  it('not held, refused and an unclean answer are never "no splits"', () => {
    expect(answerFromActions(UNAVAILABLE, 'ZZA').text).toBe("I couldn't read ZZA's splits and dividends: none are held for it on the server (they are held once its chart has been opened in UCT, and this answer never asks the vendor), or the read failed. Open the stock's chart in UCT, then ask again. No split or dividend is stated. That is not the same as none.")
    expect(answerFromActions(REFUSED, 'ZZA').text).toBe(`I couldn't read ZZA's splits and dividends: ${REFUSED_WORDS}. No split or dividend is stated. That is not the same as none.`)
    for (const bad of [{ splits: null }, { dividends: 'x' }, { splits: { rows: null } }]) {
      const a = honest(answerFromActions(actionsEnv(bad), 'ZZA'))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read ZZA's splits and dividends: UCT's data did not answer cleanly. No split or dividend is stated. That is not the same as none.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the limits and every field the answer reads are the kind\'s own (read from the adapter) and the CACT panel\'s', () => {
    const src = adapter('corporate_actions_read')
    expect(pyKind(src)).toBe(KINDS.actions)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([ACTIONS_DEFAULT_ROWS, ACTIONS_MAX_ROWS])
    expect(ACTIONS_DEFAULT_ROWS).toBe(CACT_ROWS_SHOWN)
    expect(pyTuple(src, 'BLOCKS')).toEqual(['splits', 'dividends'])
    for (const key of [...plain(actionsEnv().data), ...plain(actionsEnv().data.splits), ...plain(SPLITS()[0]), ...plain(DIVS()[0]), 'basis']) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── calendar.ipos → stock.ipoCalendar ──────────────────────────────────────────────────────────────────────────────────
const deal = (symbol, name, date, exchange, priceRange, shares, value, status) => ({ symbol, name, date, exchange, price_range: priceRange, shares, value, status, isolated: true })
const AHEAD = () => [deal('ZZQA', 'Made-up Robotics Inc', '2026-11-20', 'NASDAQ', '$18.00-$20.00', 12500000, 250000000, 'expected'),
  deal(null, 'Made-up Foods Corp', '2026-11-24', null, null, null, null, 'expected')]
const EARLIER = () => [deal('ZZQB', 'Made-up Bio Ltd', '2026-11-12', 'NYSE', '$21.00', 8000000, 168000000, 'priced')]
const ipoEnv = (over = {}, envOver = {}) => envelope(KINDS.ipos, {
  window: { from: '2026-11-09', to: '2026-11-27', isolated: true }, split_day: '2026-11-19',
  ahead: { rows: AHEAD(), count: 2, total: 2, cut: false, isolated: true }, earlier: { rows: EARLIER(), count: 1, total: 1, cut: false, isolated: true },
  total: 3, dropped: 0, as_of: null, read_at: READ_AT, ...over,
}, { freshness: 'periodic', as_of: null, ...envOver })
const IPO_HEAD = "The IPO calendar for Mon, Nov 9, 2026 to Fri, Nov 27, 2026 as UCT holds it, merged from two vendors' calendars:"
const IPO_READ = "The calendars give no as-of time of their own. UCT read them at 9:05 AM ET (UCT's own time), and this answer never asks the vendors."
const IPO_LEAD = "Stocks first traded in the last year are UCT's new listings list, not this calendar."

describe('stock.ipoCalendar — the answer', () => {
  it('today and ahead soonest first, earlier newest first, each deal as the calendar gives it, with when UCT read it', () => {
    const a = honest(answerFromIpos(ipoEnv()))
    expect(a.text.split('\n')).toEqual([
      IPO_HEAD,
      'Today and ahead, soonest first:',
      '• Nov 20, 2026: Made-up Robotics Inc (ZZQA), NASDAQ: $18.00 to $20.00, 12.5M shares, value $250.0M, expected',
      '• Nov 24, 2026: Made-up Foods Corp: price not given, shares not given, value not given, expected',
      'Earlier in the window, newest first:',
      '• Nov 12, 2026: Made-up Bio Ltd (ZZQB), NYSE: $21.00, 8.0M shares, value $168.0M, priced',
      '1 deal has a field the calendars leave empty: it is not stated, and that is not 0.',
      IPO_VALUE_WORDS,
      IPO_READ,
      IPO_LEAD,
      IPO_SOURCE_LINE,
    ])
    expect(a.facts).toMatchObject({ window: { from: '2026-11-09', to: '2026-11-27' }, total: 3, gaps: 1, as_of: null, read_at: READ_AT, read: '9:05 AM ET' })
    expect(a.facts.ahead.rows[1]).toEqual({ symbol: null, name: 'Made-up Foods Corp', date: '2026-11-24', exchange: null, price_range: null, shares: null, value: null, status: 'expected' })
    expect(a.table.rows[1]).toEqual({ day: 'Nov 24, 2026', company: 'Made-up Foods Corp', price: 'not given', shares: 'not given', value: 'not given', status: 'Expected' })
    expect(a.text).not.toMatch(/\$0\b|\b0 shares/)
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'IPO calendar' })
    expect(IPO_RECORD).toBe(`A calendar of deals, ${NOT_ADVICE}.`)
  })
  it('a cut list says so and from which end; an empty calendar is said as the vendors listing none; no read time is said', () => {
    const cut = honest(answerFromIpos(ipoEnv({ ahead: { rows: AHEAD().slice(0, 1), count: 1, total: 6, cut: true }, earlier: { rows: EARLIER(), count: 1, total: 4, cut: true } })))
    const lines = cut.text.split('\n')
    expect(lines).toContain('6 deals are on the calendar for today and ahead and the soonest 1 are in this answer: the list is cut from the far end.')
    expect(lines).toContain('4 earlier deals are on the calendar and the newest 1 are in this answer: the list is cut from the old end.')
    expect(cut.facts).toMatchObject({ ahead: { count: 1, total: 6, cut: true }, earlier: { count: 1, total: 4, cut: true } })
    const none = honest(answerFromIpos(ipoEnv({ ahead: { rows: [], count: 0, total: 0, cut: false }, earlier: { rows: [], count: 0, total: 0, cut: false }, total: 0 })))
    expect(none.text.split('\n')).toEqual([IPO_HEAD, 'No deal is on the calendar for that window in what UCT holds: the vendor calendars that answered list none.', IPO_READ, IPO_LEAD, IPO_SOURCE_LINE])
    const onlyEarlier = honest(answerFromIpos(ipoEnv({ ahead: { rows: [], count: 0, total: 0, cut: false } })))
    expect(onlyEarlier.text.split('\n')[1]).toBe('No deal is on the calendar for today or the days ahead.')
    const bare = honest(answerFromIpos(ipoEnv({ read_at: null })))
    expect(bare.text).toContain('The calendars give no as-of time of their own, and the answer carries no time UCT read them, so I cannot say how old it is.')
  })
  it('not held, refused and an unclean answer are never "no IPOs"', () => {
    expect(answerFromIpos(UNAVAILABLE).text).toBe("I couldn't read the IPO calendar: none is held on the server for the window the IPO calendar panel reads (this answer never asks the vendors), both vendors failed when UCT last read them, or the read failed. Open the IPO calendar panel (IPO) in UCT, then ask again. No IPO is stated. That is not the same as no IPOs.")
    expect(answerFromIpos(REFUSED).text).toBe(`I couldn't read the IPO calendar: ${REFUSED_WORDS}. No IPO is stated. That is not the same as no IPOs.`)
    for (const bad of [{ window: null }, { ahead: null }, { earlier: { rows: 'x' } }, { window: { from: 'soon', to: '2026-11-27' } }]) {
      const a = honest(answerFromIpos(ipoEnv(bad)))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read the IPO calendar: UCT's data did not answer cleanly. No IPO is stated. That is not the same as no IPOs.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the limits, the window and every field the answer reads are the kind\'s own (read from the adapter) and the IPO panel\'s', () => {
    const src = adapter('ipo_calendar_read')
    expect(pyKind(src)).toBe(KINDS.ipos)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([IPO_DEFAULT_ROWS, IPO_MAX_ROWS])
    expect(pyTuple(src, 'FIELDS')).toEqual(plain(AHEAD()[0]))
    // the adapter reads exactly the window the panel asks the route for (so the panel's held answer is the one read)
    const [back, forward] = [pyInt(src, 'WINDOW_BACK_DAYS'), pyInt(src, 'WINDOW_FORWARD_DAYS')]
    for (const [today, monday] of [['2026-11-19', '2026-11-16'], ['2026-11-22', '2026-11-16'], ['2026-11-23', '2026-11-23'], ['2027-01-01', '2026-12-28']]) {
      const at = (d) => { const x = new Date(`${monday}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
      expect(ipoWindow(today), today).toEqual({ from: at(-back), to: at(forward) })
    }
    for (const key of [...plain(ipoEnv().data), ...plain(ipoEnv().data.ahead), 'from', 'to']) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── calendar.dividends → stock.dividendsCalendar ────────────────────────────────────────────────────────────────────────
const ev = (symbol, type, date, amount, ratio) => ({ symbol, type, date, amount, ratio, isolated: true })
const stock = (symbol, state, readAt, events) => ({ symbol, state, read_at: readAt, events, isolated: true })
const divEnv = (over = {}, envOver = {}) => envelope(KINDS.dividends, {
  symbols: ['ZZA'], stocks: [stock('ZZA', 'complete', READ_AT, 2)], rows: [ev('ZZA', 'dividend', '2026-12-04', 0.26, null), ev('ZZA', 'split', '2027-01-15', null, '4:1')],
  count: 2, total: 2, cut: false, as_of: null, read_at: READ_AT, ...over,
}, { freshness: 'periodic', as_of: null, ...envOver })
const DIV_TAIL = ["Past dividends and splits are the Corporate actions panel's (CACT). This answer reads only the stocks named, never your own lists.", DIVIDENDS_SOURCE_LINE]

describe('stock.dividendsCalendar — the answer', () => {
  it('each stock\'s next ex-dividend date with its amount as declared and every split ahead, soonest first, with when UCT read it', () => {
    const a = honest(answerFromDividends(divEnv(), ['ZZA']))
    expect(a.text.split('\n')).toEqual([
      'Dividends and splits declared ahead for ZZA, soonest first, as UCT read them:',
      '• Dec 4, 2026: ZZA goes ex-dividend, $0.26 a share as declared',
      '• Jan 15, 2027: ZZA splits 4 for 1',
      "A forward calendar has no as-of time of its own. UCT read this stock's calendar at 9:05 AM ET (UCT's own time), so an event dated before today may have passed since. This answer never asks the vendor.",
      ...DIV_TAIL,
    ])
    expect(a.facts).toMatchObject({ symbols: ['ZZA'], held: ['ZZA'], not_held: [], incomplete: [], none: [], count: 2, total: 2, cut: false, as_of: null, read: '9:05 AM ET', partial: false })
    expect(a.facts.rows).toEqual([{ symbol: 'ZZA', type: 'dividend', date: '2026-12-04', amount: 0.26, ratio: null }, { symbol: 'ZZA', type: 'split', date: '2027-01-15', amount: null, ratio: '4:1' }])
    expect(a.table.rows).toEqual([{ day: 'Dec 4, 2026', symbol: 'ZZA', event: 'Ex-dividend', detail: '$0.26 a share' }, { day: 'Jan 15, 2027', symbol: 'ZZA', event: 'Split', detail: '4 for 1' }])
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'Dividend calendar' })
    expect(DIVIDENDS_RECORD).toBe(`A calendar of declared events, ${NOT_ADVICE}.`)
  })
  it('a stock not held is named and left out, an incomplete read is never "none", a stock held whole with nothing ahead is said, an amount not declared is never $0', () => {
    const env = divEnv({
      symbols: ['ZZB', 'ZZA', 'ZZC', 'ZZD'],
      stocks: [stock('ZZB', 'not_held', null, null), stock('ZZA', 'complete', READ_AT, 2), stock('ZZC', 'complete', READ_AT, 0), stock('ZZD', 'incomplete', '2026-11-19T15:25:00Z', 1)],
      rows: [ev('ZZD', 'dividend', '2026-11-27', null, null), ev('ZZA', 'dividend', '2026-12-04', 0.26, null), ev('ZZA', 'split', '2027-01-15', null, '4:1')], count: 3, total: 3,
    }, { status: 'partial' })
    const a = honest(answerFromDividends(env, ['ZZB', 'ZZA', 'ZZC', 'ZZD']))
    expect(a.text.split('\n')).toEqual([
      'Dividends and splits declared ahead for ZZA, ZZC and ZZD, soonest first, as UCT read them:',
      '• Nov 27, 2026: ZZD goes ex-dividend, amount not declared',
      '• Dec 4, 2026: ZZA goes ex-dividend, $0.26 a share as declared',
      '• Jan 15, 2027: ZZA splits 4 for 1',
      'Nothing is declared ahead for ZZC in what UCT read.',
      "UCT's last read of ZZD did not fully answer, so events may be missing there: that is not the same as none.",
      'Nothing is held on the server for ZZB, so it is not in this answer, which is not the same as nothing ahead. Open the dividend calendar panel (DVD) for it in UCT, then ask again.',
      '1 dividend has no declared amount: it is not stated, and that is not $0.',
      "A forward calendar has no as-of time of its own. UCT read these calendars at 9:05 AM ET (UCT's own time, the oldest of them), so an event dated before today may have passed since. This answer never asks the vendor.",
      ...DIV_TAIL,
    ])
    expect(a.facts).toMatchObject({ not_held: ['ZZB'], incomplete: ['ZZD'], none: ['ZZC'], partial: true })
    expect(a.table.rows[0]).toEqual({ day: 'Nov 27, 2026', symbol: 'ZZD', event: 'Ex-dividend', detail: 'not given' })
    expect(a.text).not.toMatch(/\$0\.00/)
    const two = honest(answerFromDividends(divEnv({ symbols: ['ZZA', 'ZZB', 'ZZE'], stocks: [stock('ZZA', 'complete', READ_AT, 2), stock('ZZB', 'not_held', null, null), stock('ZZE', 'not_held', null, null)] }, { status: 'partial' }), ['ZZA', 'ZZB', 'ZZE']))
    expect(two.text).toContain('Nothing is held on the server for ZZB and ZZE, so they are not in this answer, which is not the same as nothing ahead. Open the dividend calendar panel (DVD) for each of them in UCT, then ask again.')
    expect(Object.keys(DIVIDEND_STATES)).toEqual(['complete', 'incomplete', 'not_held'])
  })
  it('a cut list says so and from which end; no event and no read time are each said', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ev('ZZA', 'split', `2027-01-${String(10 + i).padStart(2, '0')}`, null, '2:1'))
    const cut = honest(answerFromDividends(divEnv({ rows, count: 7, total: 52, cut: true }), ['ZZA']))
    expect(cut.text.split('\n')).toContain('2 more are in the table.')
    expect(cut.text.split('\n')).toContain('52 events are held for these stocks and the soonest 7 are in this answer: the list is cut from the far end.')
    const none = honest(answerFromDividends(divEnv({ stocks: [stock('ZZA', 'incomplete', READ_AT, 0)], rows: [], count: 0, total: 0, read_at: null }, { status: 'partial' }), ['ZZA']))
    expect(none.text.split('\n')).toContain('No event is in this answer.')
    expect(none.text).toContain('A forward calendar has no as-of time of its own, and the answer carries no time UCT read it, so I cannot say how old it is.')
    expect(none.text).not.toMatch(/Nothing is declared ahead/)
    expect(none.table).toBeUndefined()
  })
  it('not held, refused and an unclean answer are never "no dividend"', () => {
    expect(answerFromDividends(UNAVAILABLE, ['ZZA', 'ZZB']).text).toBe("I couldn't read the dividend calendar for ZZA and ZZB: nothing is held on the server for these stocks alone (this answer never asks the vendor), or the read failed. Open the dividend calendar panel (DVD) for each stock in UCT, then ask again. No dividend or split is stated. That is not the same as none ahead.")
    expect(answerFromDividends(REFUSED, ['ZZA']).text).toBe(`I couldn't read the dividend calendar for ZZA: ${REFUSED_WORDS}. No dividend or split is stated. That is not the same as none ahead.`)
    for (const bad of [{ rows: null }, { stocks: 'x' }, { stocks: [stock('ZZA', 'weird', READ_AT, 1)] }]) {
      const a = honest(answerFromDividends(divEnv(bad), ['ZZA']))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read the dividend calendar for ZZA: UCT's data did not answer cleanly. No dividend or split is stated. That is not the same as none ahead.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the limits, the states and every field the answer reads are the kind\'s own (read from the adapter) and the DVD panel\'s', () => {
    const src = adapter('dividends_calendar_read')
    expect(pyKind(src)).toBe(KINDS.dividends)
    expect(pyInt(src, 'MAX_SYMBOLS')).toBe(DIVIDENDS_MAX_SYMBOLS)
    expect(DIVIDENDS_MAX_SYMBOLS).toBeLessThan(DVD_SYMBOL_CAP)
    expect(pyTuple(src, 'STATES')).toEqual(Object.keys(DIVIDEND_STATES))
    expect(pyTuple(src, 'EVENT_TYPES')).toEqual(['dividend', 'split'])
    for (const key of [...plain(divEnv().data), ...plain(divEnv().data.rows[0]), ...plain(divEnv().data.stocks[0])]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── served vs dark, isolation on both sides, the manifest limits, the read each answer makes ───────────────────────────
let calls, ENVS
function wire(kinds) {
  calls = []; ENVS = {}
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') { const e = ENVS[body.kind]; return json((typeof e === 'function' ? e(body.params) : e) || { status: 'refused', data: null, notes: ['refused'] }) }
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const KEYS = Object.keys(KINDS)
const ALL = Object.values(CAPABILITIES)
const PAIRS = KEYS.map(k => [KINDS[k], CAPABILITIES[k]])
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetCotForTest(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest(); _resetTerminalWave3ForTest(); _resetTerminalWave4ForTest();
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest(); _resetTerminalWave7ForTest(); _resetTerminalWave8ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the three kinds and the three capabilities, by name', () => {
    expect(KINDS).toEqual({ actions: 'stock.corporateActions', ipos: 'calendar.ipos', dividends: 'calendar.dividends' })
    expect(CAPABILITIES).toEqual({ actions: 'stock.splitsDividends', ipos: 'stock.ipoCalendar', dividends: 'stock.dividendsCalendar' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'rates.treasury', 'leaders.longRun', 'dilution.watch', 'market.regime', 'setup.playbook'], 'other kinds only']])('dark (%j, %s): none of the three is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave8Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave8Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all three served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const turnPy = py('api/services/uct_agent/turn.py')
    const dataReads = /^DATA_READ_ACTIONS = frozenset\(\{([\s\S]*?)^\}\)/m.exec(turnPy)[1]
    for (const [kind, name] of PAIRS) {
      const cap = getCapability(name)
      expect(cap, name).toBeTruthy()
      expect(cap.query, name).toBe(true)
      expect(cap.localOnly, name).toBe(true)
      expect(groupOfAction(name), name).toBe(ROUTE_GROUP)            // the wave's own group, by action: never the stock data group
      expect(cap.summary.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
      expect(cap.hints.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
      expect(cap.hints, name).toMatch(/never today/)                    // the planner is told what the date is, and that it is never the ask
      expect(cap.hints, name).toMatch(/reply: one short line, no figures\.$/)
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all three kinds of this wave are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments (rows clamped to the kind\'s own limits)', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.actions] = (p) => actionsEnv({ symbol: p.symbol })
    ENVS[KINDS.ipos] = () => ipoEnv()
    ENVS[KINDS.dividends] = (p) => divEnv({ symbols: p.symbols, stocks: p.symbols.map(s => stock(s, 'complete', READ_AT, 0)), rows: [], count: 0, total: 0 })
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.actions, { symbol: '$nvda', rows: null })).text).toMatch(/^NVDA's splits and cash dividends as UCT holds them/)
    expect((await run(CAPABILITIES.actions, { symbol: 'brk.b', rows: 999 })).text).toMatch(/^BRK-B's splits and cash dividends/)
    expect((await run(CAPABILITIES.actions, { symbol: 'NVDA', rows: 0 })).text).toMatch(/^NVDA's splits/)
    expect((await run(CAPABILITIES.ipos, { rows: null })).text).toMatch(/^The IPO calendar for Mon, Nov 9, 2026/)
    expect((await run(CAPABILITIES.ipos, { rows: 99 })).text).toMatch(/^The IPO calendar/)
    expect((await run(CAPABILITIES.dividends, { symbols: ['$ko', 'pep', 'KO'] })).text).toMatch(/^Dividends and splits declared ahead for KO and PEP/)
    expect((await run(CAPABILITIES.dividends, { symbols: 'brk.b, jnj' })).text).toMatch(/^Dividends and splits declared ahead for BRK-B and JNJ/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.actions, { symbol: 'NVDA', rows: 12 }, 'answer'],
      [KINDS.actions, { symbol: 'BRK-B', rows: 60 }, 'answer'],
      [KINDS.actions, { symbol: 'NVDA', rows: 1 }, 'answer'],
      [KINDS.ipos, { rows: 20 }, 'answer'],
      [KINDS.ipos, { rows: 50 }, 'answer'],
      [KINDS.dividends, { symbols: ['KO', 'PEP'] }, 'answer'],
      [KINDS.dividends, { symbols: ['BRK-B', 'JNJ'] }, 'answer'],
    ])
  })

  it('no read without a turn, a usable ticker or a bounded list of them, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const GOOD = { [CAPABILITIES.actions]: { symbol: 'NVDA', rows: null }, [CAPABILITIES.ipos]: { rows: null }, [CAPABILITIES.dividends]: { symbols: ['NVDA'] } }
    for (const name of ALL) expect((await getCapability(name).answer(null, GOOD[name], null)).text, name).toMatch(/needs the Agent's turn/)
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    for (const symbol of ['', 'the market', 'I:SPX', 'TOOLONGX', null]) {
      expect((await run(CAPABILITIES.actions, { symbol, rows: null })).text, String(symbol)).toBe("Which stock's splits and dividends should I read? Give me one ticker. Nothing is stated.")
    }
    for (const symbols of [[], null, ['the market'], ['NVDA', 'TOOLONGX'], 'I:SPX']) {
      expect((await run(CAPABILITIES.dividends, { symbols })).text, JSON.stringify(symbols)).toBe(`Which stocks' dividends and splits ahead should I read? Name one to ${DIVIDENDS_MAX_SYMBOLS} tickers. Nothing is stated.`)
    }
    const eleven = Array.from({ length: DIVIDENDS_MAX_SYMBOLS + 1 }, (_, i) => `Z${String.fromCharCode(65 + i)}`)
    expect((await run(CAPABILITIES.dividends, { symbols: eleven })).text).toBe(`I can read the dividends and splits ahead for at most ${DIVIDENDS_MAX_SYMBOLS} stocks at a time: name ${DIVIDENDS_MAX_SYMBOLS} or fewer. Nothing is stated.`)
    expect(reads()).toEqual([])
    for (const name of ALL) {                                           // the stub refuses every kind
      const a = await run(name, GOOD[name])
      expect(a.text, name).toMatch(/^I couldn't read .*: that request wasn't allowed for this question, so nothing was read\./)
      expect(a.facts, name).toBeUndefined()
    }
    expect(reads()).toHaveLength(ALL.length)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const DATA_BASE = [...groupWords('data')]              // read before anything is served: routing.js's own lists
const SCREENER_BASE = [...groupWords('screener')]
const CALENDAR_BASE = [...groupWords('calendar')]
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE8_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  actions: ['NVDA corporate actions', 'corporate actions for TSLA', 'split history for AAPL', 'has NVDA ever split', 'when did AAPL last split', 'did TSLA do a reverse stock split',
    'past dividends for KO', 'dividend history of JNJ'],
  ipos: ['IPO calendar', 'upcoming IPOs', 'what IPOs are coming this week', 'which IPOs are pricing next week', 'IPOs this week', 'any IPOs tomorrow', 'expected IPOs', 'ipos priced last week'],
  dividends: ['next ex-dividend date for KO', 'upcoming dividends for AAPL and MSFT', "when is NVDA's next dividend", 'any upcoming splits for NVDA', 'when does JNJ go ex dividend',
    'dividend calendar for KO and PEP', 'is AAPL paying a dividend next month', 'any announced stock splits for TSLA'],
}
/** another capability's language: none of the three's words may name these */
const NOT_OURS = [
  'split the screen', 'split my screen in two', 'split the chart into two panes', 'duplicate this chart and split the cell', 'split', 'splits', 'tile the charts evenly',   // the board
  'show dividend markers on the chart', 'turn on split markers', 'hide the IPO markers', 'turn off earnings and dividend markers', 'show the chart since IPO', 'range since ipo',  // a chart's settings and range
  'recent IPOs', 'new listings', 'IPOs in the last year', 'newly listed stocks', 'new IPOs this week', 'stocks that recently IPOed',                                            // LEAD's new listings
  'stocks with a dividend yield above 3%', 'scan for dividend stocks', 'high dividend yield stocks', 'dividend aristocrats', 'find stocks with upcoming dividends', 'dividend growth stocks', // screens
  'dividends for my watchlist', 'upcoming dividends in my portfolio', 'ex-dividend dates for my positions', 'alert me before KO goes ex-dividend', 'notify me of upcoming IPOs',          // the member's own lists, alerts
  'what is a stock split', 'what is an ipo', 'what does ex-dividend mean', 'explain corporate actions', 'what is the ex-dividend date', 'how do stock splits work', 'define dividend',  // what a term means: the guide
  'any news on the NVDA stock split', 'why did NVDA split its stock', 'IPO news today',                                                                                         // news
  'earnings calendar', "what's on the calendar this week", 'who reports this week', 'economic calendar', 'when does NVDA report', 'NVDA earnings date', 'NVDA dividend yield',      // the calendar, the data group
  'dividend', 'dividends', 'ipo', 'ipos', 'calendar', 'corporate', 'markets', 'markets board', 'how are the markets doing', 'open the IPO calendar panel', 'go to the dividend calendar page',
  'NVDA dilution', 'what is the market regime', 'NVDA IV history', 'confirmed setups on NVDA', 'NVDA events timeline', 'the UCT 20', 'treasury yields', 'NVDA seasonality',          // waves 6 and 7
  'short interest on NVDA', 'dark pool levels on NVDA', 'what got upgraded today', 'top gainers today', 'compare nvda with amd', 'NVDA relative strength',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'recent IPOs', 'newly listed', 'which themes are rotating in',
  'what is on the confluence board', 'expected move for NVDA earnings', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings reactions for yesterday', 'earnings season today',
  'call themes this month', 'short interest on NVDA', 'NVDA days to cover', 'NVDA seasonality', 'market tide history', 'open interest change on NVDA', 'treasury yields',
  'what is the market regime', 'confirmed setups on NVDA', 'NVDA events timeline', 'the UCT 20', 'NVDA IV history', 'NVDA dilution', 'does TSLA have a shelf registration']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the three by action with no word of its own, and it is the 50th group', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups (56 since the integrator's wave 7 build); this wave's is the 50th, and the cap is
    // not changed here. A later wave's group comes after it (agentTerminalDataWave9.test.js pins how many are left)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([50, 56, true])
    expect(GROUPS.map(x => x.id).slice(45, 50)).toEqual([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    // no action of this wave is in any other group's list, and wave 7's group keeps its six
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
    expect(GROUPS.find(x => x.id === WAVE7_GROUP).actions).toHaveLength(6)
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'rates.treasury', 'dilution.watch', 'market.regime'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data, screener and calendar groups keep exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    expect(groupWords('calendar')).toEqual(CALENDAR_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE8_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    expect(groupWords('calendar')).toEqual(CALENDAR_BASE)
    expect([groupWords(WAVE4_GROUP), groupWords(WAVE5_GROUP), groupWords(WAVE6_GROUP), groupWords(WAVE7_GROUP), groupWords('cot')]).toEqual([[], [], [], [], []])
    // the OTHER two's asks are not sent to the group while only this one is served
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave8Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE8_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE8_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toEqual([key])
  })

  it('served: each ask routes its capability under v1 and v2, and the budget never cuts the group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const [key, asks] of Object.entries(ASKS)) {
      for (const q of asks) {
        expect(wordsSelect(ROUTE_GROUP, q), q).toBe(true)
        expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
        for (const route of [routeManifest, routeManifestV2]) {
          const r = route(full, q, ROUTE_OPTS())
          expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITIES[key])
          expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain(ROUTE_GROUP)
        }
      }
    }
  })

  it('served: the words never name another capability\'s language, and v1 does not send the group for it either', async () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const q of NOT_OURS) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('the nearest neighbours keep their own asks: the board\'s split screen, a chart\'s markers and range, LEAD\'s new listings, the earnings calendar, a screen, a meaning', async () => {
    wire([...PAIRS.map(p => p[0]), 'leaders.longRun', 'quotes', 'quote', 'earnings', 'bars.daily', 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(['stock.longRunLeaders', 'chart.setSetting']))     // non-vacuity: the neighbours are registered
    const routed = (q) => [routeManifest, routeManifestV2].map(route => [route.name, route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)])
    // "split": the board's split screen stays the chart grid's
    for (const q of ['split the screen', 'split the screen into four charts']) {
      expect(selectGroups(q).selected, q).toContain('chartGrid')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // a chart's split / dividend / IPO markers stay the chart's settings
    for (const q of ['show dividend markers on the chart', 'turn on split markers', 'hide the IPO markers']) {
      expect(selectGroups(q).selected, q).toContain('charts')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // "IPO": the stocks first traded in the last year stay LEAD's new listings, and this wave's group does not ride with them
    for (const q of ['recent IPOs', 'new listings', 'IPOs in the last year']) {
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain('stock.longRunLeaders')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // the earnings calendar, a screen and a meaning stay theirs
    for (const q of ["what's on the calendar this week", 'earnings calendar', 'high dividend yield stocks', 'scan for dividend stocks', 'what is a stock split', 'what does ex-dividend mean']) {
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // this wave's asks route its capabilities, and LEAD's new listings is never the IPO calendar's answer under v1
    for (const [q, key] of [['upcoming IPOs', 'ipos'], ['IPO calendar', 'ipos'], ['split history for AAPL', 'actions'], ['next ex-dividend date for KO', 'dividends']]) {
      expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain(CAPABILITIES[key])
    }
    // a bare word selects nothing of this wave under v1
    for (const q of ['split', 'splits', 'dividend', 'dividends', 'ipo', 'ipos', 'calendar', 'corporate', 'markets', 'actions']) {
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm', 'dividends', 'ipos', 'split']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the typo lexicon: registering the three changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'make it shorter', 'sorted results', 'hover over it', 'recover the layout', 'floating window', 'rank them', 'interesting names today', 'whats the reprot date',
      'the newst one', 'offen', 'the sme one', 'frist one', 'munth view', 'each one', 'ago', 'weak names', 'the bord', 'corprate', 'coporate', 'dividned', 'divdend', 'dividen', 'ipos', 'iop', 'calender',
      'calandar', 'splt', 'spilt', 'actons', 'ex-divdend', 'upcomming', 'anounced', 'declard', 'pricng', 'expcted']
    // A capability's NAME is fixed and its words join the lexicon. The names were chosen for that: `stock.corporateActions`
    // and `stock.dividendCalendar` (the first names tried) added "actions" and "dividend", which changed how "earnings
    // reactions" and "divided by" in OTHER capabilities' corpus phrasings are corrected. `stock.splitsDividends`,
    // `stock.ipoCalendar` and `stock.dividendsCalendar` add no word at all (the typos above, near this wave's words, show it)
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = () => { const lex = lexiconFor(null); return texts.map(t => fix(t, lex)) }
    const before = read()
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    // the three add NO word to the lexicon: their names' words are already known, and a summary's and a hint's other words are
    // either already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual([])
  })

  it('no OTHER capability\'s capreg corpus phrasing is named by these words (armed, the group rides with none of them)', () => {
    // every corpus phrasing but this wave's own: production's and the dark ones (the corpus runs them with every kind on)
    const others = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text))]
    expect(others.length).toBeGreaterThan(500)
    expect(others.filter(t => wordKeys(t).length)).toEqual([])
  })

  it('this wave\'s own corpus phrasings are each named by their own capability\'s words (four dark phrasings each)', () => {
    for (const key of KEYS) {
      const mine = allPhrasings().filter(p => p.intent.id === CAPABILITIES[key]).map(p => p.ph.text)
      expect(mine.length, key).toBeGreaterThanOrEqual(4)
      for (const q of mine) expect(wordKeys(q), q).toEqual([key])
    }
  })

  it('the earlier waves\' words name none of this wave\'s asks, and these words name none of theirs', () => {
    const earlier = [namedBy(TERMINAL_ROUTE_WORDS), namedBy(WAVE2_ROUTE_WORDS), namedBy(WAVE3_ROUTE_WORDS), namedBy(WAVE4_ROUTE_WORDS), namedBy(WAVE5_ROUTE_WORDS), namedBy(WAVE6_ROUTE_WORDS),
      namedBy(WAVE7_ROUTE_WORDS)]
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(earlier.flatMap(f => f(q)), q).toEqual([])
    // this wave's own corpus phrasings too: each earlier wave's test holds its words off every OTHER corpus phrasing
    const mine = allPhrasings().filter(p => ALL.includes(p.intent.id)).map(p => p.ph.text)
    expect(mine).toHaveLength(12)
    for (const q of mine) expect(earlier.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(earlier.flatMap(f => f(q)).length, q).toBeGreaterThan(0)    // non-vacuity: an earlier wave really names it
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no row of the routing-collision table is named by these words (every row belongs to another group)', () => {
    // baseline/routingCollisions.json is asserted under production's kinds, where these words are not armed: this holds it armed
    expect(collisions.rows.length).toBeGreaterThan(10)
    const stolen = collisions.rows.filter(r => r.owner !== ROUTE_GROUP && !(r.also || []).includes(ROUTE_GROUP) && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
