// Terminal data wave 9 — three LOCAL-ONLY capabilities over three model-isolated kinds (MD-1 §4.18):
//   stock.auctionCalendar ← rates.auctions · stock.realCurve ← rates.realYields · stock.fomcWatch ← fed.watch.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date (the newest auction record, the real curve's day, each Fed block's own date) and when UCT read it, never
// calls a missing number 0, says when a list is cut and from which end, never calls "not held" or a failed read "none",
// names every Fed block that is not stated, never names the news wire's vendor, and never echoes an envelope note.
// Routing: the three share ONE words-only group of their own (`marketRates`, the 51st of the 56 the server keeps). Each
// capability's own words are armed only while it is registered, and they never name another capability's language: a stock's
// opening or closing auction, a breakeven trade in the journal, a news collection named Fed, the Treasury yields' own words,
// the economic and earnings calendars, alerts, navigation, and what a term means.
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
import { AUCT_RESULTS_SHOWN } from '../pages/terminal/panels/treasuryAuctionsModel'
import { BOARD_CITE } from '../pages/terminal/panels/fedWatchModel'
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
import { _resetTerminalWave8ForTest, WAVE8_ROUTE_WORDS, ROUTE_GROUP as WAVE8_GROUP } from './capabilities/terminalDataWave8'
import {
  KINDS, CAPABILITIES, NOT_ADVICE, AUCTIONS_DEFAULT_ROWS, AUCTIONS_MAX_ROWS, AUCTIONS_RECORD, AUCTIONS_SOURCE, RATE_KINDS, BIDDER_CLASSES,
  REAL_HORIZONS, REAL_RECORD, REAL_SOURCE_LINE, FED_DEFAULT_ROWS, FED_MAX_ROWS, FED_BLOCKS, FED_BLOCK_NAMES, FED_STATE_WORDS, FED_LEFT_OUT, FED_OTHERS,
  answerFromAuctions, answerFromReal, answerFromFed, registerTerminalWave9Capabilities, _resetTerminalWave9ForTest, WAVE9_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave9'

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
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2026-11-17T05:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
/** the news wire's vendor and the market-data vendors: an answer never names them */
const VENDORS = /\b(?:tradexchange|trade exchange|txnews|massive|polygon|finnhub|fmp|financial modeling prep|yahoo)\b/i
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

// ── rates.auctions → stock.auctionCalendar ─────────────────────────────────────────────────────────────────────────────
const split = (dealers, direct, indirect) => ({ primary_dealers: { amount: dealers * 1e8, share: dealers }, direct: { amount: direct * 1e8, share: direct },
  indirect: { amount: indirect * 1e8, share: indirect }, total: (dealers + direct + indirect) * 1e8, isolated: true })
const up = (type, term, day, amount, over = {}) => ({ security_type: type, security_term: term, auction_date: day, issue_date: '2026-11-30', announced_date: '2026-11-12',
  offering_amount: amount, reopening: false, cusip: null, isolated: true, ...over })
const res = (type, term, day, rate, kind, cover, bidders, over = {}) => ({ security_type: type, security_term: term, auction_date: day, issue_date: '2026-11-16',
  maturity_date: '2036-11-15', offering_amount: 42000000000, rate, rate_kind: kind, bid_to_cover: cover, reopening: false, tips: false, floating_rate: false,
  cash_management: false, cusip: null, bidders, isolated: true, ...over })
const UPCOMING = () => [up('Bond', '20-Year', '2026-11-23', 16000000000, { reopening: true }), up('Note', '7-Year', '2026-11-24', 44000000000)]
const RESULTS = () => [res('Bill', '4-Week', '2026-11-17', 4.25, 'high_rate', 2.91, null), res('Note', '10-Year', '2026-11-12', 4.117, 'high_yield', 2.58, split(10, 20, 70))]
const auctionsEnv = (over = {}, envOver = {}) => envelope(KINDS.auctions, {
  as_of: '2026-11-17', upcoming_as_of: '2026-11-17', results_through: '2026-11-17', window_days: 45,
  upcoming: { rows: UPCOMING(), count: 2, total: 2, cut: false, isolated: true }, results: { rows: RESULTS(), count: 2, total: 2, cut: false, isolated: true },
  dropped: 0, publisher_cut: { upcoming: false, results: false, isolated: true }, read_at: READ_AT, basis: 'as_published', source: 'US Treasury Fiscal Data', check: null, ...over,
}, { as_of: '2026-11-17T05:00:00Z', ...envOver })
const AUCT_DATES = "The list of coming auctions is the Treasury's as of Tue, Nov 17, 2026, and results run through Tue, Nov 17, 2026: the records' own dates, never the time of this answer."
const AUCT_READ = "UCT read the records at 9:05 AM ET (UCT's own time), and this answer never asks the Treasury."

describe('stock.auctionCalendar — the answer', () => {
  it('the auctions coming up soonest first and the results newest first, each as the Treasury publishes it, with the records\' own dates', () => {
    const a = honest(answerFromAuctions(auctionsEnv()))
    expect(a.text.split('\n')).toEqual([
      "US Treasury auctions as UCT holds them, from the Treasury's Fiscal Data service:",
      'Coming up, soonest first:',
      '• Nov 23, 2026: 20-Year Bond (reopening), $16.00B offered, issued Nov 30, 2026',
      '• Nov 24, 2026: 7-Year Note, $44.00B offered, issued Nov 30, 2026',
      'Results in the last 45 days, newest first:',
      '• Nov 17, 2026: 4-Week Bill: high rate 4.250%, bid-to-cover 2.91, bidder split not given',
      '• Nov 12, 2026: 10-Year Note: high yield 4.117%, bid-to-cover 2.58, indirect 70.0%, direct 20.0%, dealers 10.0%',
      '1 auction has a figure the Treasury left empty: it is not stated, and that is not 0.',
      AUCT_DATES,
      AUCT_READ,
      AUCTIONS_SOURCE,
    ])
    expect(a.facts).toMatchObject({ as_of: '2026-11-17', window_days: 45, gaps: 1, read: '9:05 AM ET', stale: false, check_failed: false })
    expect(a.facts.upcoming).toMatchObject({ count: 2, total: 2, cut: false })
    expect(a.facts.results.rows[1].bidders).toEqual({ indirect: 70, direct: 20, dealers: 10 })
    expect(a.table.rows[2]).toEqual({ day: 'Nov 17, 2026', security: '4-Week Bill', kind: 'Result', detail: 'high rate 4.250%, bid-to-cover 2.91, bidder split not given' })
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'Treasury auctions' })
    expect(AUCTIONS_RECORD).toBe(`A record and a schedule, ${NOT_ADVICE}.`)
  })
  it('a figure the Treasury left empty is never 0; a cut list says so and from which end, and the publisher\'s own cut is said', () => {
    const a = honest(answerFromAuctions(auctionsEnv({
      upcoming: { rows: [up('Bill', '13-Week', '2026-11-23', null)], count: 1, total: 9, cut: true },
      results: { rows: [res('Bond', '30-Year', '2026-11-13', null, null, null, null)], count: 1, total: 7, cut: true },
      publisher_cut: { upcoming: false, results: true },
    })))
    const lines = a.text.split('\n')
    expect(lines).toContain('• Nov 23, 2026: 13-Week Bill, amount not given, issued Nov 30, 2026')
    expect(lines).toContain('• Nov 13, 2026: 30-Year Bond: rate not given, bid-to-cover not given, bidder split not given')
    expect(lines).toContain('9 auctions are listed as coming up and the soonest 1 are in this answer: the list is cut from the far end.')
    expect(lines).toContain('7 auction results are held and the newest 1 are in this answer: the list is cut from the old end.')
    expect(lines).toContain('The Treasury held more rows than the one page UCT reads, so the oldest results are not in what UCT holds.')
    expect(lines).toContain('2 auctions have a figure the Treasury left empty: it is not stated, and that is not 0.')
    expect(a.text).not.toMatch(/\$0\b|0\.000%|bid-to-cover 0\b/)
  })
  it('empty lists are what the records list; a stale answer and a failed look are said and never refreshed', () => {
    const none = honest(answerFromAuctions(auctionsEnv({ upcoming: { rows: [], count: 0, total: 0, cut: false }, results: { rows: [], count: 0, total: 0, cut: false },
      as_of: null, upcoming_as_of: null, results_through: null }, { as_of: null })))
    expect(none.text.split('\n')).toEqual([
      "US Treasury auctions as UCT holds them, from the Treasury's Fiscal Data service:",
      "The Treasury's records UCT holds list no auction coming up.",
      "The Treasury's records UCT holds list no auction with a result in the last 45 days.",
      'The records carry no date of their own.',
      AUCT_READ,
      AUCTIONS_SOURCE,
    ])
    expect(none.table).toBeUndefined()
    const stale = honest(answerFromAuctions(auctionsEnv({}, { stale: true })))
    expect(stale.text).toContain("Stale: the Treasury's evening update has passed since UCT read these records, so newer ones may exist. This answer never looks for them.")
    const looked = honest(answerFromAuctions(auctionsEnv({ check: { state: 'failed', reason: 'source', http_status: 503, at: READ_AT } }, { stale: true })))
    expect(looked.text).toContain("Stale: UCT's last look for newer auction records did not go well, so these are the last records it read.")
    expect(looked.text).not.toMatch(/evening update/)
  })
  it('not held, refused and an unclean answer are never "no auctions"', () => {
    expect(answerFromAuctions(UNAVAILABLE).text).toBe("I couldn't read the Treasury auctions: none are held on the server yet (this answer never asks the Treasury), or the read failed. Open the Treasury auctions panel (AUCT) in UCT, then ask again. No auction is stated. That is not the same as no auctions.")
    expect(answerFromAuctions(REFUSED).text).toBe(`I couldn't read the Treasury auctions: ${REFUSED_WORDS}. No auction is stated. That is not the same as no auctions.`)
    for (const bad of [{ upcoming: null }, { results: 'x' }, { upcoming: { rows: null } }]) {
      const a = honest(answerFromAuctions(auctionsEnv(bad)))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read the Treasury auctions: UCT's data did not answer cleanly. No auction is stated. That is not the same as no auctions.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the limits and every field the answer reads are the kind\'s own (read from the adapter) and the AUCT panel\'s', () => {
    const src = adapter('treasury_auctions_read')
    expect(pyKind(src)).toBe(KINDS.auctions)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([AUCTIONS_DEFAULT_ROWS, AUCTIONS_MAX_ROWS])
    expect(AUCTIONS_DEFAULT_ROWS).toBe(AUCT_RESULTS_SHOWN)
    expect(pyTuple(src, 'RATE_KINDS')).toEqual([...RATE_KINDS])
    expect(pyTuple(src, 'BIDDER_CLASSES').sort()).toEqual(Object.keys(BIDDER_CLASSES).sort())
    expect(pyTuple(src, 'UPCOMING_FIELDS')).toEqual(plain(UPCOMING()[0]))
    expect(pyTuple(src, 'RESULT_FIELDS')).toEqual(plain(RESULTS()[0]))
    for (const key of [...plain(auctionsEnv().data), ...plain(auctionsEnv().data.upcoming)]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── rates.realYields → stock.realCurve ─────────────────────────────────────────────────────────────────────────────────
const mat = (key, label, y, d1, w1) => ({ key, label, months: null, yield: y, was: { d1: null, w1: null, isolated: true }, change_bp: { d1, w1, isolated: true }, isolated: true })
const be = (key, label, nominal, real, value, date = '2026-11-17') => ({ key, label, months: null, date, nominal, real, value, isolated: true })
const MATS = () => [mat('5y', '5-year', 1.21, -4, 10), mat('10y', '10-year', 1.64, 4, 14), mat('30y', '30-year', null, null, null)]
const BES = () => [be('5y', '5-year', 3.85, 1.21, 2.64), be('10y', '10-year', 4.12, 1.64, 2.48), be('30y', '30-year', 4.61, null, null)]
const realEnv = (over = {}, envOver = {}) => envelope(KINDS.real, {
  as_of: '2026-11-17', ref_dates: { d1: '2026-11-16', w1: '2026-11-10', isolated: true }, maturities: MATS(), breakevens: { as_of: '2026-11-17', rows: BES(), isolated: true },
  rows: 7, read_at: READ_AT, basis: 'end_of_day', source: 'US Treasury daily par real yield curve', check: null, ...over,
}, { freshness: 'historical', ...envOver })
const REAL_READ = "Read by UCT from the Treasury's website at 9:05 AM ET (UCT's own time)."
const END_OF_DAY = 'These are end-of-day figures published by the US Treasury, not quotes from a session still trading.'

describe('stock.realCurve — the answer', () => {
  it('each real yield with its change and its breakeven, the curve\'s own date and the breakevens\' own date', () => {
    const a = honest(answerFromReal(realEnv()))
    expect(a.text.split('\n')).toEqual([
      'US Treasury real yields (inflation-protected securities) by maturity, end-of-day figures for Tue, Nov 17, 2026:',
      '• 5-year: 1.21%, -4 bp from the day before, breakeven 2.64%',
      '• 10-year: 1.64%, +4 bp from the day before, breakeven 2.48%',
      '• 30-year: no real figure for that day',
      'The breakevens are the nominal yield minus the real yield at the same maturity on Tue, Nov 17, 2026.',
      '30-year has no breakeven, since a side is missing: it is not stated, and that is not 0.',
      END_OF_DAY,
      REAL_READ,
      REAL_SOURCE_LINE,
    ])
    expect(a.facts).toMatchObject({ as_of: '2026-11-17', breakeven_as_of: '2026-11-17', missing: ['30-year'], no_reference: [], read: '9:05 AM ET', stale: false })
    expect(a.facts.maturities[2]).toEqual({ key: '30y', label: '30-year', yield_pct: null, change_bp: { d1: null, w1: null }, breakeven: null })
    expect(a.table.rows[2]).toEqual({ maturity: '30-year', real: 'not given', d1: 'not given', w1: 'not given', breakeven: 'not given' })
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'Real yields' })
    expect(REAL_RECORD).toBe(`End-of-day figures, ${NOT_ADVICE}.`)
    expect(Object.keys(REAL_HORIZONS)).toEqual(['d1', 'w1'])
  })
  it('breakevens for an older day, or none at all, are said; a breakeven dated another day is not shown as one; a missing reference is never 0', () => {
    const older = honest(answerFromReal(realEnv({ breakevens: { as_of: '2026-11-16', rows: [be('5y', '5-year', 3.8, 1.25, 2.55, '2026-11-16'), be('10y', '10-year', 4.1, 1.6, 2.5, '2026-11-13')] } })))
    expect(older.text).toContain('The breakevens are for Mon, Nov 16, 2026, the newest day both curves have a figure: the nominal yield minus the real yield at the same maturity.')
    expect(older.text).toContain('• 10-year: 1.64%, +4 bp from the day before, breakeven not given')
    const none = honest(answerFromReal(realEnv({ breakevens: { as_of: null, rows: [] }, ref_dates: { d1: null, w1: '2026-11-10' } })))
    expect(none.text).toContain('No breakeven is stated: the nominal and the real curve have no day in common in what UCT holds, and that is not a breakeven of 0.')
    expect(none.text).toContain('No real figure was found near enough to the day before, so that change is not stated: that is not a change of 0.')
    expect(none.text).not.toMatch(/breakeven 0|\b0\.00%/)
  })
  it('a curve behind and a failed look are said as stale, and never looked for', () => {
    expect(honest(answerFromReal(realEnv({}, { stale: true }))).text).toContain("Stale: the newest real figure UCT holds is Nov 17, 2026, and a later day's figures may be out. This answer never looks for one.")
    const looked = honest(answerFromReal(realEnv({ check: { state: 'failed', reason: 'source', http_status: 503, at: READ_AT } }, { stale: true })))
    expect(looked.text).toContain("Stale: UCT's last look for newer real yields did not go well, so these are the last figures it read and a newer day may exist.")
  })
  it('not held, refused and an unclean answer are never "no figure"', () => {
    expect(answerFromReal(UNAVAILABLE).text).toBe("I couldn't read real yields: none are held on the server yet (this answer never requests them from the Treasury's website), or the read failed. Open the Treasury yields panel (RATES) in UCT, then ask again. No figure is stated. That is not the same as no figure.")
    expect(answerFromReal(REFUSED).text).toBe(`I couldn't read real yields: ${REFUSED_WORDS}. No figure is stated. That is not the same as no figure.`)
    for (const bad of [{ as_of: null }, { maturities: 'x' }, { breakevens: null }, { maturities: [mat('5y', '5-year', null, null, null)] }]) {
      const a = honest(answerFromReal(realEnv(bad)))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read real yields: UCT's data did not answer cleanly. No figure is stated. That is not the same as no figure.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the horizons and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('real_yields_read')
    expect(pyKind(src)).toBe(KINDS.real)
    expect(pyTuple(src, 'HORIZONS')).toEqual(Object.keys(REAL_HORIZONS))
    for (const key of [...plain(realEnv().data), ...plain(MATS()[0]), ...plain(BES()[0])]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── fed.watch → stock.fomcWatch ────────────────────────────────────────────────────────────────────────────────────────
const NOTICE = 'The New York Fed notice for the two rates, invented for this test.'
const CREDIT = 'Invented credit line for the New York Fed survey.'
const fedBlocks = () => ({
  statement: { state: 'ok', source: 'Federal Reserve Board', read_at: '2026-11-04T19:05:00Z', check: null, date: '2026-11-04', url: null, minutes: null,
    redline: { state: 'ok', previous: { date: '2026-09-16', url: null }, added: 14, removed: 6,
      changes: { rows: [{ text: 'The Committee voted 10-0 on this invented statement.', was: 'The Committee voted 9-1 on this invented statement.', added: 1, removed: 1 },
        { text: 'Voting for the action were every invented member.', was: null, added: 8, removed: 0 }], count: 2, total: 2, cut: false } } },
  speeches: { state: 'ok', source: 'Federal Reserve Board', read_at: READ_AT, rows: [{ kind: 'speech', speaker: 'Quillfeather', title: 'Notes on Orchard Credit', where: 'the Invented Lending Forum', published: '2026-11-18T15:00:00Z', url: null },
    { kind: 'testimony', speaker: 'Brindlewood', title: 'Semiannual Invented Report', where: 'the Committee on Invented Affairs', published: '2026-11-17T14:00:00Z', url: null }], count: 2, total: 2, cut: false, missing: [], checks: null },
  headlines: { state: 'ok', source: 'news wire', rows: [{ text: "Fed's Quillfeather invented remark on orchards", received_at: '2026-11-19T14:58:00Z', tickers: [] },
    { text: 'Governor Brindlewood says invented things', received_at: '2026-11-18T21:30:00Z', tickers: [] }], count: 2, matched: 2, scanned: 3000, cut: false, newest_at: '2026-11-19T14:58:00Z' },
  next_meeting: { state: 'ok', source: 'the economic calendar', date: '2026-12-09', time: '2:00 PM', event: 'FOMC Statement', label: null, days_to_go: 20 },
  rates: { state: 'ok', source: 'Federal Reserve Bank of New York', notice: NOTICE, effective: { value: 9.12, date: '2026-11-18' }, upper: { value: 9.25, date: '2026-11-18' }, lower: { value: 9.0, date: '2026-11-18' } },
  projections: { state: 'ok', source: 'Federal Reserve Board', check: null, date: '2026-09-16', meeting: 'September 15-16', release_url: null, page_url: null,
    medians: [{ label: '2026', value: 9.4 }, { label: '2027', value: 8.9 }, { label: 'Longer run', value: 7.0 }], read_at: READ_AT },
  survey: { state: 'ok', source: 'Federal Reserve Bank of New York', check: null, survey: 'October 2026', questions_sent: '2026-10-15', responses_due: '2026-10-20',
    before_meeting: { label: 'Oct. 27-28 2026', date: '2026-10-28' }, path: [{ label: 'Dec. 8-9 2026', date: '2026-12-09', median: 9.13, p25: 8.88, p75: 9.13, respondents: 29 }],
    credit: CREDIT, file_url: null, read_at: READ_AT },
})
const fedEnv = (over = {}, envOver = {}) => envelope(KINDS.fed, { ...fedBlocks(), as_of: null, board_cite: BOARD_CITE, left_out: ['statement_text', 'this_week_speakers', 'survey_distributions'], ...over },
  { as_of: null, ...envOver })
const FED_TAIL = [FED_LEFT_OUT, BOARD_CITE, FED_OTHERS]

describe('stock.fomcWatch — the answer', () => {
  it('every block in order with its own source and date: what changed in the statement, the next decision, the rates with the notice, the projections, the survey with its credit, the speeches and the headlines', () => {
    const a = honest(answerFromFed(fedEnv()))
    expect(a.text.split('\n')).toEqual([
      'The Fed watch as UCT holds it, block by block:',
      "FOMC statement of Wed, Nov 4, 2026. Against the statement of Wed, Sep 16, 2026: 14 words added and 6 words removed. What changed, in the statement's order:",
      '• New: “The Committee voted 10-0 on this invented statement.” Before: “The Committee voted 9-1 on this invented statement.”',
      '• New: “Voting for the action were every invented member.” (a new passage)',
      "Next FOMC decision: Wed, Dec 9, 2026, 2:00 PM ET (in 20 days), from the economic calendar UCT holds.",
      'Federal funds rates: effective 9.12% (Nov 18, 2026); target range 9.00% to 9.25% (Nov 18, 2026).',
      NOTICE,
      "The officials' median projection of the federal funds rate (Summary of Economic Projections, September 15-16 meeting, released Sep 16, 2026): 2026 9.4%, 2027 8.9%, Longer run 7%.",
      "New York Fed Survey of Market Expectations, October 2026, responses due Oct 20, 2026: the respondents' median most-likely target rate Dec. 8-9 2026 9.13%. These are the respondents' figures, not market prices and not a UCT forecast.",
      CREDIT,
      'Fed speeches and testimony, newest first:',
      '• Nov 18, 2026: Quillfeather, “Notes on Orchard Credit” (speech), the Invented Lending Forum',
      '• Nov 17, 2026: Brindlewood, “Semiannual Invented Report” (testimony), the Committee on Invented Affairs',
      'Fed headlines from the news wire UCT receives, newest first, each with the time UCT received it:',
      "• 9:58 AM ET: “Fed's Quillfeather invented remark on orchards”",
      '• Wed, Nov 18, 4:30 PM ET: “Governor Brindlewood says invented things”',
      ...FED_TAIL,
    ])
    expect(a.facts.states).toEqual(Object.fromEntries(FED_BLOCKS.map(k => [k, 'ok'])))
    expect(a.facts).toMatchObject({ as_of: null, stale: false, partial: false })
    expect(a.facts.statement).toMatchObject({ date: '2026-11-04', redline: 'ok', previous: '2026-09-16', added: 14, removed: 6, changes: 2, changes_total: 2 })
    expect(a.facts.rates.effective).toEqual({ value: 9.12, date: '2026-11-18' })
    expect(a.table.rows[0]).toEqual({ block: 'Statement change', date: 'Nov 4, 2026', detail: 'New: The Committee voted 10-0 on this invented statement. / Before: The Committee voted 9-1 on this invented statement.' })
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'Fed watch' })
    expect(a.present.items.map(i => i.label)).toEqual(['FOMC statement', 'Next decision', 'Effective rate', 'Projection', 'Survey median'])
  })
  it('a block that is not held, refused, unreadable or switched off keeps its place and is said in fixed words; a missing rate is never 0', () => {
    const env = fedEnv({ headlines: { state: 'off', source: 'news wire' }, rates: { state: 'not_held', source: 'Federal Reserve Bank of New York', notice: NOTICE, effective: { value: null, date: null }, upper: { value: null, date: null }, lower: { value: null, date: null } },
      survey: { state: 'unavailable', source: 'Federal Reserve Bank of New York', check: null }, projections: { state: 'unreadable', source: 'Federal Reserve Board', check: null },
      speeches: { state: 'not_held', source: 'Federal Reserve Board' }, next_meeting: { state: 'not_held', source: null } }, { status: 'partial' })
    const a = honest(answerFromFed(env))
    const lines = a.text.split('\n')
    expect(lines).toContain(`Fed headlines: ${FED_STATE_WORDS.off}`)
    expect(lines).toContain(`Federal funds rates: ${FED_STATE_WORDS.not_held}`)
    expect(lines).toContain(`New York Fed survey: ${FED_STATE_WORDS.unavailable}`)
    expect(lines).toContain(`Rate projections: ${FED_STATE_WORDS.unreadable}`)
    expect(lines).toContain(`Fed speeches and testimony: ${FED_STATE_WORDS.not_held}`)
    expect(lines).toContain(`Next FOMC decision: ${FED_STATE_WORDS.not_held}`)
    expect(a.text).not.toContain(NOTICE)                                  // the notice rides only beside figures
    expect(a.text).not.toMatch(/\b0\.00%/)
    expect(a.facts).toMatchObject({ partial: true, states: { headlines: 'off', rates: 'not_held', survey: 'unavailable', projections: 'unreadable' } })
    // one rate held, two not: the two said, never 0
    const one = honest(answerFromFed(fedEnv({ rates: { state: 'ok', source: 'x', notice: NOTICE, effective: { value: 9.12, date: '2026-11-18' }, upper: { value: null, date: null }, lower: { value: null, date: null } } })))
    expect(one.text).toContain('Federal funds rates: effective 9.12% (Nov 18, 2026); the target range is not held.')
  })
  it('each redline state is said, never as "no change"; a cut list of changes and of headlines says so and from which end', () => {
    const red = (r) => fedEnv({ statement: { ...fedBlocks().statement, redline: { previous: { date: '2026-09-16' }, ...r } } })
    expect(honest(answerFromFed(red({ state: 'same', added: 0, removed: 0, changes: { rows: [], count: 0, total: 0, cut: false } }))).text).toContain('FOMC statement of Wed, Nov 4, 2026. Not one word changed from the statement of Wed, Sep 16, 2026.')
    expect(honest(answerFromFed(red({ state: 'not_held', added: null, removed: null, changes: null }))).text).toContain('FOMC statement of Wed, Nov 4, 2026. The statement before it (Wed, Sep 16, 2026) is not held yet, so no change is stated: that is not the same as no change.')
    expect(honest(answerFromFed(red({ state: 'unreadable', added: null, removed: null, changes: null }))).text).toContain('could not be read, so no change is stated: that is not the same as no change.')
    expect(honest(answerFromFed(red({ state: 'no_previous', previous: null, added: null, removed: null, changes: null }))).text).toContain('FOMC statement of Wed, Nov 4, 2026. No earlier statement is held to compare it with, so no change is stated.')
    const many = Array.from({ length: 8 }, (_, i) => ({ text: `Invented passage ${i}.`, was: null, added: 3, removed: 0 }))
    const cut = honest(answerFromFed(red({ state: 'ok', added: 24, removed: 0, changes: { rows: many, count: 8, total: 11, cut: true } })))
    expect(cut.text.split('\n')).toContain('5 more are in the table.')
    expect(cut.text.split('\n')).toContain('11 passages changed and the first 8 are in this answer: the list is cut from the end.')
    const heads = honest(answerFromFed(fedEnv({ headlines: { ...fedBlocks().headlines, matched: 40, scanned: 3000, cut: true } })))
    expect(heads.text.split('\n')).toContain('40 Fed headlines are held in the newest 3000 on the wire and the newest 2 are in this answer: the list is cut from the old end.')
    const speeches = honest(answerFromFed(fedEnv({ speeches: { ...fedBlocks().speeches, total: 15, cut: true } })))
    expect(speeches.text.split('\n')).toContain('15 speeches and testimony are listed and the newest 2 are in this answer: the list is cut from the old end.')
  })
  it('a stale read is said; the next decision from the survey says so; the Board\'s citation comes from the read', () => {
    const a = honest(answerFromFed(fedEnv({ next_meeting: { state: 'ok', source: 'Federal Reserve Bank of New York (the meeting dates in its Survey of Market Expectations)', date: '2026-12-09', time: null, event: null, label: 'Dec. 8-9 2026', days_to_go: 1 } }, { stale: true })))
    expect(a.text).toContain("Next FOMC decision: Wed, Dec 9, 2026 (tomorrow), from the meeting dates in the New York Fed's survey.")
    expect(a.text).toContain("Stale: UCT's last look at the Board's or the New York Fed's website did not go well, so some blocks are what UCT read before. This answer never looks again.")
    expect(a.text.split('\n')).toContain(BOARD_CITE)
  })
  it('not held, refused and an unclean answer are never "no Fed news"', () => {
    expect(answerFromFed(UNAVAILABLE).text).toBe("I couldn't read the Fed watch: nothing of it is held on the server yet (this answer never asks the Board, the New York Fed or the news wire), or the read failed. Open the Fed watch panel (FED) in UCT, then ask again. Nothing of the Fed watch is stated. That is not the same as no Fed news.")
    expect(answerFromFed(REFUSED).text).toBe(`I couldn't read the Fed watch: ${REFUSED_WORDS}. Nothing of the Fed watch is stated. That is not the same as no Fed news.`)
    for (const bad of [{ statement: null }, { rates: 'x' }, { survey: { source: 'x' } }]) {
      const a = honest(answerFromFed(fedEnv(bad)))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read the Fed watch: UCT's data did not answer cleanly. Nothing of the Fed watch is stated. That is not the same as no Fed news.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the limits, the blocks, the states and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('fed_watch_read')
    expect(pyKind(src)).toBe(KINDS.fed)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([FED_DEFAULT_ROWS, FED_MAX_ROWS])
    expect(pyTuple(src, 'BLOCKS')).toEqual([...FED_BLOCKS])
    expect([...pyTuple(src, 'STATES')].filter(s => s !== 'ok').sort()).toEqual(Object.keys(FED_STATE_WORDS).sort())
    for (const k of FED_BLOCKS) expect(FED_BLOCK_NAMES[k], k).toBeTruthy()
    const b = fedBlocks()
    for (const key of [...plain(fedEnv().data), ...plain(b.statement), ...plain(b.statement.redline), ...plain(b.speeches), ...plain(b.speeches.rows[0]),
      ...plain(b.headlines), ...plain(b.headlines.rows[0]), ...plain(b.next_meeting), ...plain(b.rates), ...plain(b.projections), ...plain(b.survey), ...plain(b.survey.path[0])]) {
      expect(src.includes(`"${key}"`), key).toBe(true)
    }
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
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest(); _resetTerminalWave7ForTest(); _resetTerminalWave8ForTest(); _resetTerminalWave9ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the three kinds and the three capabilities, by name', () => {
    expect(KINDS).toEqual({ auctions: 'rates.auctions', real: 'rates.realYields', fed: 'fed.watch' })
    expect(CAPABILITIES).toEqual({ auctions: 'stock.auctionCalendar', real: 'stock.realCurve', fed: 'stock.fomcWatch' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'rates.treasury', 'calendar.ipos', 'dilution.watch', 'market.regime'], 'other kinds only']])('dark (%j, %s): none of the three is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave9Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave9Capabilities()).toEqual([])            // idempotent
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
    ENVS[KINDS.auctions] = () => auctionsEnv()
    ENVS[KINDS.real] = () => realEnv()
    ENVS[KINDS.fed] = () => fedEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.auctions, { rows: null })).text).toMatch(/^US Treasury auctions as UCT holds them/)
    expect((await run(CAPABILITIES.auctions, { rows: 999 })).text).toMatch(/^US Treasury auctions/)
    expect((await run(CAPABILITIES.auctions, { rows: 0 })).text).toMatch(/^US Treasury auctions/)
    expect((await run(CAPABILITIES.real, {})).text).toMatch(/^US Treasury real yields/)
    expect((await run(CAPABILITIES.fed, { rows: null })).text).toMatch(/^The Fed watch as UCT holds it/)
    expect((await run(CAPABILITIES.fed, { rows: 99 })).text).toMatch(/^The Fed watch/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.auctions, { rows: 12 }, 'answer'],
      [KINDS.auctions, { rows: 50 }, 'answer'],
      [KINDS.auctions, { rows: 1 }, 'answer'],
      [KINDS.real, {}, 'answer'],
      [KINDS.fed, { rows: 10 }, 'answer'],
      [KINDS.fed, { rows: 15 }, 'answer'],
    ])
  })

  it('no read without a turn, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const GOOD = { [CAPABILITIES.auctions]: { rows: null }, [CAPABILITIES.real]: {}, [CAPABILITIES.fed]: { rows: null } }
    for (const name of ALL) expect((await getCapability(name).answer(null, GOOD[name], null)).text, name).toMatch(/needs the Agent's turn/)
    expect(reads()).toEqual([])
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
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
const CALENDAR_BASE = [...groupWords('calendar')]
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE9_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  auctions: ['treasury auctions', 'upcoming treasury auctions', 'how did the 10-year auction go', 'treasury auction results', 'any bond auctions this week',
    'what was the bid to cover on the 30-year auction', '2-year note auction results', 'when is the next 7-year auction'],
  real: ['real yields', 'TIPS yields', 'what are real rates doing', 'inflation breakevens', 'the 10-year breakeven', 'breakeven inflation', 'show me the tips curve', 'where are real yields'],
  fed: ['fed watch', 'what did the fed say', 'what changed in the FOMC statement', 'when is the next FOMC meeting', 'fed speakers this week', 'latest fed headlines',
    'show me the fed dot plot', 'what is the fed funds rate at', 'survey of market expectations', 'will the fed cut rates'],
}
/** asks wave 6's Treasury yields words name too: both groups ride along, and both capabilities are offered */
const SHARED_WITH_WAVE6 = ['the 10-year real yield', 'treasury real yields', 'the real yield curve']
/** another capability's language: none of the three's words may name these */
const NOT_OURS = [
  'closing auction volume for NVDA', 'NVDA opening auction imbalance', 'MOC imbalances today', 'the closing cross on SPY', 'auction', 'auctions',     // a stock's auctions
  'how many breakeven trades did I have', 'my breakeven trades this month', 'what is my win rate', 'show my losses', 'breakeven',                       // the journal
  'create a collection called Fed', 'rename my Macro collection to Fed', 'the story about the Fed I saved', 'fed', 'fedex earnings', 'FDX earnings date',  // news collections, FedEx
  'what is the fomc', 'explain the dot plot', 'what are real yields', 'what is a treasury auction', 'what does bid to cover mean', 'define breakeven inflation',    // what a term means
  'treasury yields', 'the 10-year yield', 'is the yield curve inverted', 'bond yields', '2s10s spread',                                                    // wave 6's own
  'economic calendar', "what's on the calendar this week", 'earnings calendar', 'who reports this week', 'when does NVDA report', 'NVDA dividend yield',
  'alert me before the FOMC decision', 'open the FED panel', 'go to the fed watch page', 'notify me of treasury auctions', 'scan for stocks above the 10-year yield',
  'real', 'rates', 'yield', 'IPO calendar', 'NVDA corporate actions', 'next ex-dividend date for KO', 'what is the market regime', 'NVDA news', 'what got upgraded today',
  'short interest on NVDA', 'NVDA seasonality', 'fed up with this chart',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'recent IPOs', 'newly listed', 'which themes are rotating in',
  'what is on the confluence board', 'expected move for NVDA earnings', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings reactions for yesterday', 'earnings season today',
  'call themes this month', 'short interest on NVDA', 'NVDA days to cover', 'NVDA seasonality', 'market tide history', 'open interest change on NVDA', 'treasury yields', 'the 10-year yield',
  'what is the market regime', 'confirmed setups on NVDA', 'NVDA events timeline', 'the UCT 20', 'NVDA IV history', 'NVDA dilution', 'NVDA corporate actions', 'IPO calendar',
  'upcoming IPOs', 'next ex-dividend date for KO', 'split history for AAPL']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the three by action with no word of its own, and it is the 51st of the 56 the server keeps', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups (56 since the integrator's wave 7 build); this wave's is the 51st, and the cap is
    // not changed here
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.length, max, max - GROUPS.length]).toEqual([51, 56, 5])
    expect(GROUPS.map(x => x.id).slice(-6)).toEqual([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    // no action of this wave is in any other group's list, and the earlier waves' groups keep theirs
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
    expect([GROUPS.find(x => x.id === WAVE6_GROUP).actions.length, GROUPS.find(x => x.id === WAVE8_GROUP).actions.length]).toEqual([5, 3])
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'rates.treasury', 'calendar.ipos', 'market.regime'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data and calendar groups keep exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('calendar')).toEqual(CALENDAR_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE9_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('calendar')).toEqual(CALENDAR_BASE)
    expect([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, 'cot'].map(groupWords)).toEqual([[], [], [], [], [], []])
    // the OTHER two's asks are not sent to the group while only this one is served
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave9Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE9_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE9_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
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

  it('the nearest neighbours keep their own asks: the Treasury yields, the journal, a news collection, the calendars, a meaning; a shared real-yield ask offers both', async () => {
    wire([...PAIRS.map(p => p[0]), 'rates.treasury', 'quotes', 'quote', 'earnings', 'bars.daily', 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(['stock.treasuryYields']))   // non-vacuity: the neighbour is registered
    const routed = (q) => [routeManifest, routeManifestV2].map(route => [route.name, route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)])
    // the Treasury yields' own asks stay wave 6's, and this wave's group does not ride with them
    for (const q of ['treasury yields', 'the 10-year yield', 'is the yield curve inverted']) {
      expect(selectGroups(q).selected, q).toContain(WAVE6_GROUP)
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain('stock.treasuryYields')
    }
    // a real-yield ask in the Treasury yields' own words: both groups ride along, and both capabilities are offered
    for (const q of SHARED_WITH_WAVE6) {
      expect(namedBy({ treasury: WAVE6_ROUTE_WORDS.treasury })(q), q).toEqual(['treasury'])
      expect(wordKeys(q), q).toEqual(['real'])
      expect(selectGroups(q).selected, q).toEqual(expect.arrayContaining([WAVE6_GROUP, ROUTE_GROUP]))
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toEqual(expect.arrayContaining(['stock.treasuryYields', CAPABILITIES.real]))
    }
    // the journal's breakeven trades, a news collection named Fed, the calendars and a meaning stay theirs
    for (const q of ['how many breakeven trades did I have', 'create a collection called Fed', 'economic calendar', "what's on the calendar this week", 'what is the fomc', 'closing auction volume for NVDA']) {
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // this wave's asks route its capabilities
    for (const [q, key] of [['treasury auctions', 'auctions'], ['real yields', 'real'], ['inflation breakevens', 'real'], ['what changed in the FOMC statement', 'fed']]) {
      expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain(CAPABILITIES[key])
    }
    // a bare word selects nothing of this wave under v1
    for (const q of ['auction', 'auctions', 'real', 'breakeven', 'fed', 'rates', 'yield', 'tips', 'statement']) {
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm', 'fed', 'auctions', 'real']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the typo lexicon: registering the three changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A name's, a summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'make it shorter', 'sorted results', 'hover over it', 'recover the layout', 'floating window', 'rank them', 'interesting names today', 'whats the reprot date',
      'the newst one', 'offen', 'the sme one', 'frist one', 'munth view', 'each one', 'ago', 'weak names', 'the bord', 'actions', 'actons', 'caution', 'action items',
      'form', 'from', 'foam', 'feed', 'news feed', 'treasury', 'treasry', 'yeild', 'yields', 'reel', 'curv', 'wacth', 'brekeven', 'breakevn', 'upcomming', 'bid to cvoer']
    // typos of the two new words themselves: the only corrections that move, each pinned (a misspelt "auction" now reads as
    // the word; "fome" was ambiguous between "some" and "come" and stays ambiguous, so it is still left alone)
    const NEAR = { auctoin: ['[]', '["auction"]'], auctin: ['[]', '["auction"]'], fome: ['["some","come"]', '["some","come","fomc"]'] }
    // A capability's NAME is fixed and its words join the lexicon. The names were chosen for that: `stock.treasuryAuctions`
    // would add "auctions", one edit from "actions" (which no capability's words hold, so a phrasing's "actions" would be
    // corrected to it), `stock.realYields` "yields", one edit from "fields" and "yield", and `stock.fedWatch` "fed", one edit
    // from "feed". `stock.auctionCalendar`, `stock.realCurve` and `stock.fomcWatch` add only "auction" and "fomc", and the
    // phrasings above (the corpus's, and typos near those two words) show neither changes a correction
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = () => { const lex = lexiconFor(null); return texts.map(t => fix(t, lex)) }
    const near = () => { const lex = lexiconFor(null); return Object.keys(NEAR).map(t => fix(t, lex)) }
    const before = read()
    const nearBefore = near()
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    expect(Object.keys(NEAR).map((t, i) => [nearBefore[i], near()[i]])).toEqual(Object.values(NEAR))
    // the three add exactly two words to the lexicon, both from their names: every other word of a summary and a hint is either
    // already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(['auction', 'fomc'])
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
      namedBy(WAVE7_ROUTE_WORDS), namedBy(WAVE8_ROUTE_WORDS)]
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
