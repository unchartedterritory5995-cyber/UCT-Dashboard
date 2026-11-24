// Terminal data wave 6 — the five local-only capabilities over `seasonality.stock`, `seasonality.board`,
// `options.tideHistory`, `options.oiChange` and `rates.treasury`: the member's answer (the DATA'S OWN date with the time UCT
// read or stored it, never today, never live / now; a record that is not held, a board that is not built, a pair of files
// that is not prepared and a read that failed never said as "no pattern", "no flow", "no change" or "no figure"; a number
// that does not exist never as 0: a month nobody counted, a session with no stored row, a new contract's change, a maturity
// with no figure, a change with no reference day; a list that is cut said so, with the end it is cut from; an envelope's
// notes never echoed), served vs dark (each registers only while the server lists ITS kind), local-only on both sides, the
// manifest text limits, the one read each answer makes with the member's arguments (a measure, a scope and a side read by
// the panels' own word maps), and the cross-file facts read from the other file (never retyped).
// Routing: the five share ONE words-only group (`marketRecords`, the 48th, the last of the 48 the server kept then). Each
// capability's own words are on that group only while it is registered (a dark server's routing is routing.js's own), every
// plain ask reaches its capability under v1 and v2, the group never rides the fill, and the words stay off other
// capabilities' language: open interest in futures and positioning (COT), a dividend yield, win rates, a named year's
// monthly returns, sector performance over a recent period, a bare "market tide" (the session still trading), screens,
// alerts, watchlists, navigation, and what a term means.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import './terminalWaves'  // the Terminal data waves: registerServerGatedBuiltins() runs them only once this module has loaded (terminalWavesHook.js)
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, groupOfAction, routeManifest, selectGroups, wordsSelect } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { allPhrasings } from './qa/capabilityRegression/testing/corpus'
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'
import handshake from './__fixtures__/program/isolation.json'
import { SEAS_MEASURES, SEAS_MEASURE_ARG_WORDS, seasonalityBoardRead, boardFacts, SEASB_SOURCE } from '../pages/terminal/panels/seasonalityBoardModel'
import { TIDE_SCOPES, TIDE_SCOPE_ARG_WORDS, TIDE_ROWS_SHOWN, TIDE_SESSIONS_ASKED, TIDE_HISTORY_SOURCE, tideHistoryRead, sumOver } from '../pages/terminal/panels/tideHistoryModel'
import { OI_SIDES, OI_SIDE_ARG_WORDS, OI_ROWS_SHOWN, OI_CHANGE_SOURCE, oiChangeRead, limitNotes } from '../pages/terminal/panels/oiChangeModel'
import { HORIZONS, SOURCE as RATES_SOURCE, ratesRead } from '../pages/terminal/panels/ratesModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetCotForTest, CAPABILITY as COT_CAPABILITY, KIND as COT_KIND } from './capabilities/cot'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { CAPABILITIES as WAVE7_CAPS } from './capabilities/terminalDataWave7'
import { CAPABILITIES as WAVE8_CAPS } from './capabilities/terminalDataWave8'
import { CAPABILITIES as WAVE9_CAPS } from './capabilities/terminalDataWave9'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS } from './capabilities/terminalDataWave3'
import { _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS, ROUTE_GROUP as WAVE4_GROUP } from './capabilities/terminalDataWave4'
import { _resetTerminalWave5ForTest, WAVE5_ROUTE_WORDS, ROUTE_GROUP as WAVE5_GROUP } from './capabilities/terminalDataWave5'
import {
  KINDS, CAPABILITIES, SEASONALITY_RECORD, END_OF_DAY, BOARD_MEASURE_KEYS, DEFAULT_BOARD_MEASURE, BOARD_WITHOUT_WORDS,
  TIDE_SCOPE_KEYS, DEFAULT_TIDE_SCOPE, TIDE_DEFAULT_ROWS, TIDE_MAX_ROWS, OI_SIDE_KEYS, DEFAULT_OI_SIDE, OI_DEFAULT_ROWS, OI_MAX_ROWS, OI_SIDE_WORDS,
  TREASURY_HORIZON_KEYS, answerFromSeasonality, answerFromBoard, answerFromTide, answerFromOi, answerFromTreasury, measureOf, scopeOf, sideOf,
  registerTerminalWave6Capabilities, _resetTerminalWave6ForTest, WAVE6_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave6'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([\\s\\S]+?)\\)$`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const pyDict = (src, name) => Object.fromEntries([...new RegExp(`^${name} = \\{([\\s\\S]+?)\\}$`, 'm').exec(src)[1].matchAll(/"(\w+)": "([^"]+)"/g)].map(m => [m[1], m[2]]))
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
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'
const SEASON_SOURCE = `Source: ${SEASB_SOURCE}, close to close. ${SEASONALITY_RECORD}`
const COMPLETED = 'Completed sessions only: a session still trading is not in the record, and the month still running is not counted as a month.'
const READ_905 = "at 9:05 AM ET (UCT's own time)."
const NO_TIME = 'The answer carries no read time, so I cannot say how old it is.'
/** every answer of this wave: no live / now wording, never an envelope note, and never the day of the read as the data's date
 *  (the read time is printed as a time of day; the day of the read, Nov 19, appears nowhere) */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Nov 19|2026-11-19/i)
  return a
}

// ── seasonality.stock → stock.seasonality ──────────────────────────────────────────────────────────────────────────────
const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const month = (m, n, median, avg, up, o = {}) => ({ month: m, label: LABELS[m - 1], n, avg_pct: avg, median_pct: median, pct_up: up, thin: n > 0 && n < 5, isolated: true, ...o })
const MONTHS = () => [month(1, 10, 1.24, 1.5, 70), month(2, 10, -0.36, -0.2, 40), month(3, 10, 0.8, 1.1, 60), month(4, 10, 2.5, 2, 80), month(5, 10, 0.02, 0.3, 50), month(6, 10, -1.1, -0.9, 30),
  month(7, 10, 1.9, 1.7, 70), month(8, 10, -0.5, 0.1, 40), month(9, 10, -2, -1.6, 20), month(10, 3, 4, 3.5, 67), month(11, 10, 3.1, 2.8, 90), month(12, 0, null, null, null)]
const weekday = (i, label, n, avg) => ({ weekday: i, label, n, avg_pct: avg, median_pct: avg, pct_up: n ? 52 : null, isolated: true })
const WEEKDAYS = () => [weekday(0, 'Mon', 500, 0.11), weekday(1, 'Tue', 500, -0.04), weekday(2, 'Wed', 500, 0.001), weekday(3, 'Thu', 500, 0.07), weekday(4, 'Fri', 0, null)]
const seasonEnv = (over = {}, envOver = {}) => envelope(KINDS.seasonality, {
  ticker: 'NVDA', source: 'fixture', months: MONTHS(), weekdays: WEEKDAYS(), covered_from: '2016-01-04', covered_to: '2026-10-30', full_months: 129, min_years: 5, sessions: 2738,
  first_bar: '2016-01-04', last_bar: '2026-11-18', latest_completed_session: '2026-11-18', pre_vendor_floor: false, read_at: READ_AT, ...over,
}, envOver)

describe('stock.seasonality — the answer', () => {
  it('all twelve months by the record\'s own dates: a thin month flagged, a month nobody counted never 0, the weekdays, the read time beside the data\'s date', () => {
    const a = honest(answerFromSeasonality(seasonEnv(), 'NVDA'))
    expect(a.text.split('\n')).toEqual([
      'NVDA by calendar month, close to close, from the daily bars UCT holds, Jan 4, 2016 to Nov 18, 2026 (129 full months):',
      '• January: median +1.2%, average +1.5%, up 7 of 10 years',
      '• February: median -0.4%, average -0.2%, up 4 of 10 years',
      '• March: median +0.8%, average +1.1%, up 6 of 10 years',
      '• April: median +2.5%, average +2.0%, up 8 of 10 years',
      '• May: median 0.0%, average +0.3%, up 5 of 10 years',
      '• June: median -1.1%, average -0.9%, up 3 of 10 years',
      '• July: median +1.9%, average +1.7%, up 7 of 10 years',
      '• August: median -0.5%, average +0.1%, up 4 of 10 years',
      '• September: median -2.0%, average -1.6%, up 2 of 10 years',
      '• October: median +4.0%, average +3.5% over 3 years (fewer than 5 years: too few to read as a pattern)',
      '• November: median +3.1%, average +2.8%, up 9 of 10 years',
      '• December: no full month on record',
      // the thin October has the highest median of all, and is NOT the highest named
      'Of the months with 5 or more years counted, the highest median is November (+3.1%) and the lowest is September (-2.0%).',
      '1 of the twelve months has fewer than 5 years counted: too few years to read as a pattern.',
      'By weekday, the average close-to-close day: Mon +0.11%, Tue -0.04%, Wed 0.00%, Thu +0.07%.',
      `The record ends at the close of Wed, Nov 18, 2026. ${COMPLETED}`,
      `Computed by UCT from bars already held, ${READ_905}`,
      SEASON_SOURCE,
    ])
    expect(a.facts).toMatchObject({ symbol: 'NVDA', first_bar: '2016-01-04', last_bar: '2026-11-18', last_day: 'Wed, Nov 18, 2026', sessions: 2738, full_months: 129, min_years: 5, read: '9:05 AM ET', stale: false,
      pre_vendor_floor: false, thin_months: 1, empty_months: 1, highest_median: 'November', lowest_median: 'September' })
    // null, never 0: the month nobody counted and the weekday nobody counted carry no figure at all
    expect(a.facts.months[11]).toEqual({ month: 12, name: 'December', years: 0, median_pct: null, median_text: null, average_pct: null, average_text: null, pct_up: null, up_years: null, up_text: null, thin: false })
    expect(a.facts.months[9]).toMatchObject({ name: 'October', years: 3, median_pct: 4, thin: true, up_years: 2 })
    expect(a.facts.months[0]).toEqual({ month: 1, name: 'January', years: 10, median_pct: 1.24, median_text: '+1.2%', average_pct: 1.5, average_text: '+1.5%', pct_up: 70, up_years: 7, up_text: 'up 7 of 10 years', thin: false })
    expect(a.facts.weekdays[4]).toEqual({ label: 'Fri', days: 0, average_pct: null, average_text: null, pct_up: null })
    expect(a.table.rows).toHaveLength(12)
    expect(a.table.rows[11]).toEqual({ month: 'December', years: '0', median: 'not given', average: 'not given', up: 'not given' })
    expect(a.table.rows[10]).toEqual({ month: 'November', years: '10', median: '+3.1%', average: '+2.8%', up: '9 of 10' })
    expect(a.present).toMatchObject({ kind: 'metrics', title: 'NVDA seasonality, through Nov 18, 2026', short: 'NVDA seasonality' })
    expect(a.present.items).toHaveLength(11)                         // December has no figure: no tile, never a zero tile
    expect(a.present.items[9]).toEqual({ label: 'October', value: '+4.0%', note: '3 years, too few', aka: ['october'] })
  })
  it('a month the kind sends as 0 with no year counted is still no figure (the count decides, never the number)', () => {
    const months = MONTHS()
    months[11] = month(12, 0, 0, 0, 0)
    const a = honest(answerFromSeasonality(seasonEnv({ months }), 'NVDA'))
    expect(a.text).toContain('• December: no full month on record')
    expect(a.facts.months[11]).toMatchObject({ years: 0, median_pct: null, average_pct: null, pct_up: null })
  })
  it('an old newest bar is said as stale with both dates; bars before the vendor\'s first day are said; a missing read time is said', () => {
    const a = honest(answerFromSeasonality(seasonEnv({ last_bar: '2026-11-13', latest_completed_session: '2026-11-18', pre_vendor_floor: true, first_bar: '1999-01-22', read_at: null }, { stale: true }), 'NVDA'))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('NVDA by calendar month, close to close, from the daily bars UCT holds, Jan 22, 1999 to Nov 13, 2026 (129 full months):')
    expect(lines.slice(-5)).toEqual([
      "The record starts before Sep 10, 2003: the bars before that date come from a second history source (yfinance), the later ones from UCT's market-data vendor.",
      'Stale: the newest daily bar held is Nov 13, 2026, and the newest completed session is Nov 18, 2026. This answer never fetches the missing sessions.',
      `The record ends at the close of Fri, Nov 13, 2026. ${COMPLETED}`,
      NO_TIME,
      SEASON_SOURCE,
    ])
    expect(lines).toContain(NO_TIME)
    expect(a.facts).toMatchObject({ stale: true, pre_vendor_floor: true, read: null, last_bar: '2026-11-13', latest_completed_session: '2026-11-18' })
  })
  it('with fewer than two months counted in full there is no highest and no lowest', () => {
    const months = MONTHS().map(m => (m.month === 11 ? m : month(m.month, 2, 1, 1, 50)))
    const a = honest(answerFromSeasonality(seasonEnv({ months }), 'NVDA'))
    expect(a.text).not.toMatch(/highest median/)
    expect(a.facts).toMatchObject({ highest_median: null, lowest_median: null, thin_months: 11 })
    expect(a.text).toContain('11 of the twelve months have fewer than 5 years counted: too few years to read as a pattern.')
  })
  it('not held, refused and an unclean answer are never "no pattern", and state no figure', () => {
    expect(answerFromSeasonality(UNAVAILABLE, 'NVDA').text).toBe("I couldn't read NVDA's seasonality: the daily bars it needs are not held in full on the server at the moment (this answer never starts a read of a stock's history), or the read failed. Open NVDA's seasonality (SEAS) in UCT, then ask again. No figure is stated. That is not the same as no pattern.")
    expect(answerFromSeasonality(REFUSED, 'NVDA').text).toBe("I couldn't read NVDA's seasonality: that request wasn't allowed for this question, so nothing was read. No figure is stated. That is not the same as no pattern.")
    for (const bad of [{ months: MONTHS().slice(0, 11) }, { months: [...MONTHS().slice(0, 11), month(11, 10, 1, 1, 50)] }, { last_bar: 'today' }, { last_bar: null }, { first_bar: null }, { min_years: 0 }, { months: null }]) {
      const a = honest(answerFromSeasonality(seasonEnv(bad), 'NVDA'))
      expect(a.text, JSON.stringify(Object.keys(bad))).toBe("I couldn't read NVDA's seasonality: UCT's data did not answer cleanly. No figure is stated. That is not the same as no pattern.")
      expect(a.facts).toBeUndefined()
    }
    for (const a of [answerFromSeasonality(UNAVAILABLE, 'NVDA'), answerFromSeasonality(REFUSED, 'NVDA'), answerFromSeasonality(null, 'NVDA')]) { honest(a); expect(a.table).toBeUndefined(); expect(a.facts).toBeUndefined() }
  })
  it('every field the answer reads is the kind\'s own (read from the adapter, never retyped)', () => {
    const src = adapter('seasonality_stock')
    expect(pyKind(src)).toBe(KINDS.seasonality)
    expect(pyTuple(src, 'MONTH_FIELDS')).toEqual(plain(MONTHS()[0]))
    expect(pyTuple(src, 'WEEKDAY_FIELDS')).toEqual(plain(WEEKDAYS()[0]))
    for (const key of plain(seasonEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── seasonality.board → stock.seasonalityBoard ─────────────────────────────────────────────────────────────────────────
const fundMonths = (nov, dec) => LABELS.map((_, i) => (i === 10 ? month(11, ...nov) : i === 11 ? month(12, ...dec) : month(i + 1, 10, 0.5, 0.4, 60)))
const fund = (symbol, name, kind, nov, dec) => ({ symbol, name, kind, status: 'ok', months: fundMonths(nov, dec), covered_from: '2016-01-04', covered_to: '2026-10-30', full_months: 129, isolated: true })
const FUNDS = () => [fund('SPY', 'S&P 500', 'index', [10, 1.8, 1.5, 80], [10, 1.1, 0.9, 70]), fund('XLK', 'Technology', 'sector', [10, 2.6, 2.2, 90], [10, 0.4, 0.6, 60]),
  fund('XLE', 'Energy', 'sector', [10, -0.7, -0.3, 40], [10, 0, 0.2, 50]), fund('XLF', 'Financials', 'sector', [10, 1.2, 1, 60], [0, null, null, null]),
  fund('XLRE', 'Real Estate', 'sector', [3, 3.3, 3, 67], [3, 1, 1, 67]), { symbol: 'XLU', name: 'Utilities', kind: 'sector', status: 'pending', reason: 'warming', isolated: true }]
const boardEnv = (over = {}, envOver = {}) => envelope(KINDS.board, {
  funds: FUNDS(), this_month: 11, next_month: 12, et_date: '2026-11-19', min_years: 5, source: 'fixture', data_through: '2026-11-18', complete: false, settled: false,
  built_at: '2026-11-19T09:05:00-05:00', read_at: READ_AT, ...over,
}, { status: 'partial', ...envOver })

describe('stock.seasonalityBoard — the answer', () => {
  it('this month by fund, the best and the weakest sector fund by the panel\'s own rules, a thin month flagged, a fund with no numbers named with its reason', () => {
    const env = boardEnv()
    const a = honest(answerFromBoard(env))
    const facts = boardFacts(env.data)                               // the panel's own two sentences: read, never retyped
    expect(facts.best).toBe('Best sector fund in November since 2016: Technology (XLK), median +2.6%, up 9 of 10 years.')
    expect(a.text.split('\n')).toEqual([
      'Seasonality board, 5 of the 6 index and sector funds by calendar month, close to close, from the daily bars UCT holds through Nov 18, 2026.',
      'November by fund, the median November with how many of the years counted it rose:',
      '• SPY (S&P 500): +1.8%, 8 of 10 up',
      '• XLK (Technology): +2.6%, 9 of 10 up',
      '• XLE (Energy): -0.7%, 4 of 10 up',
      '• XLF (Financials): +1.2%, 6 of 10 up',
      '• XLRE (Real Estate): +3.3% over 3 years (fewer than 5 years: too few to read as a pattern)',
      facts.best,
      facts.worst,
      facts.leftOut,
      '1 fund of the 6 has no numbers and is left out, never shown as zeros: XLU (its history is still being read).',
      "The board is unfinished: a fund's history was still being read, or its read failed, when it was built. The seasonality board in UCT reads it again; this answer never does.",
      'The board covers daily bars through Wed, Nov 18, 2026; the month still running is not counted as a month.',
      `Built by UCT ${READ_905}`,
      SEASON_SOURCE,
    ])
    expect(facts.worst).toMatch(/^Weakest sector fund in November since 2016: Energy \(XLE\), median -0\.7%/)
    expect(facts.leftOut).toBe('Not counted in those two: XLRE (3 years), XLU (no numbers yet).')
    expect(a.facts).toMatchObject({ month: 11, month_name: 'November', next_month: 12, next_month_name: 'December', measure: 'median', measure_word: 'median', min_years: 5, funds: 6, with_numbers: 5,
      data_through: '2026-11-18', data_through_day: 'Wed, Nov 18, 2026', read: '9:05 AM ET', stale: false, settled: false })
    expect(a.facts.without).toEqual([{ symbol: 'XLU', status: 'pending', reason: 'warming' }])
    // null, never 0: XLF has no December on record; XLRE's thin November carries its count and no "rose" figure
    expect(a.facts.rows[3].next_month).toEqual({ years: 0, value_pct: null, text: null, thin: false, up_text: null })
    expect(a.facts.rows[4].this_month).toEqual({ years: 3, value_pct: 3.3, text: '+3.3%', thin: true, up_text: null })
    expect(a.table.rows).toHaveLength(5)
    expect(a.table.rows[3]).toEqual({ fund: 'XLF', name: 'Financials', now: '+1.2%', now_up: '6 of 10 up', next: 'not given', next_up: 'not given', since: '2016' })
    expect(a.table.columns.map(c => c.label)).toEqual(['Fund', 'Name', 'November (median)', 'November: years it rose', 'December (median)', 'December: years it rose', 'Record since'])
    expect(a.present).toMatchObject({ kind: 'metrics', title: 'Seasonality board, November (median)', short: 'Seasonality board' })
    expect(a.present.items).toHaveLength(5)
    // the kind's data IS the shape the panel reads
    expect(seasonalityBoardRead(env.data, 'median')).toMatchObject({ state: 'partial', funds: 6, thisMonth: 11, nextMonth: 12, settled: false })
  })
  it('the average is the panel\'s other measure; the best and the weakest stay on the median, as the panel\'s do', () => {
    const a = honest(answerFromBoard(boardEnv(), 'average'))
    const lines = a.text.split('\n')
    expect(lines[1]).toBe('November by fund, the average November with how many of the years counted it rose:')
    expect(lines[3]).toBe('• XLK (Technology): +2.2%, 9 of 10 up')
    expect(lines[7]).toBe(boardFacts(boardEnv().data).best)
    expect(a.facts).toMatchObject({ measure: 'average', measure_word: 'average' })
    expect(a.table.columns[2].label).toBe('November (average)')
  })
  it('a whole, settled board says all its funds and has no unfinished line; a fund that failed and one the store does not carry keep their own reasons', () => {
    const whole = boardEnv({ funds: FUNDS().slice(0, 4), complete: true, settled: true }, { status: 'ok' })
    const a = honest(answerFromBoard(whole))
    expect(a.text.split('\n')[0]).toBe('Seasonality board, all 4 index and sector funds by calendar month, close to close, from the daily bars UCT holds through Nov 18, 2026.')
    expect(a.text).not.toMatch(/unfinished|no numbers/)
    const funds = [...FUNDS().slice(0, 3), { symbol: 'XLU', name: 'Utilities', kind: 'sector', status: 'not_held', reason: null }, { symbol: 'XLB', name: 'Materials', kind: 'sector', status: 'unavailable', reason: 'boom' },
      { symbol: 'XLC', name: 'Communications', kind: 'sector', status: 'something new', reason: null }]
    const b = honest(answerFromBoard(boardEnv({ funds, settled: true })))
    expect(b.text).toContain('3 funds of the 6 have no numbers and are left out, never shown as zeros: XLU (the bar store does not carry it), XLB (its read failed or holds too little), XLC (its read failed or holds too little).')
    expect(b.text).not.toContain('boom')                             // the server's own reason for a failed read is for support, never the sentence
  })
  it('not held, refused, an unclean answer and a board with no numbers are never "no pattern"', () => {
    expect(answerFromBoard(UNAVAILABLE).text).toBe("I couldn't read the seasonality board: none is held on the server at the moment (it is built when the seasonality board is opened, and this answer never builds it), or the read failed. Open the seasonality board (SEASB) in UCT, then ask again. No figure is stated. That is not the same as no pattern.")
    expect(answerFromBoard(REFUSED).text).toMatch(/^I couldn't read the seasonality board: that request wasn't allowed for this question, so nothing was read\. No figure is stated\./)
    const none = FUNDS().map(f => ({ symbol: f.symbol, name: f.name, kind: f.kind, status: 'pending', reason: 'warming' }))
    for (const bad of [{ funds: null }, { this_month: 13 }, { data_through: 'today' }, { data_through: null }, { funds: none }]) {
      const a = honest(answerFromBoard(boardEnv(bad)))
      expect(a.text, JSON.stringify(Object.keys(bad))).toBe("I couldn't read the seasonality board: UCT's data did not answer cleanly. No figure is stated. That is not the same as no pattern.")
      expect(a.facts).toBeUndefined()
    }
    expect(honest(answerFromBoard(boardEnv(), 'banana')).text).toMatch(/did not answer cleanly/)
  })
  it('a measure is read by the SEASB panel\'s own word map, never a second one; the reasons are the kind\'s own (read from both files)', () => {
    for (const [word, key] of Object.entries(SEAS_MEASURE_ARG_WORDS)) {
      expect(measureOf(word), word).toBe(key)
      expect(measureOf(word.toLowerCase()), word).toBe(key)
    }
    for (const key of Object.keys(SEAS_MEASURES)) expect(measureOf(key)).toBe(key)
    expect([measureOf(null), measureOf(undefined), measureOf('')]).toEqual([DEFAULT_BOARD_MEASURE, DEFAULT_BOARD_MEASURE, DEFAULT_BOARD_MEASURE])
    expect([measureOf('banana'), measureOf('best'), measureOf(3), measureOf('constructor'), measureOf('toString')]).toEqual([null, null, null, null, null])
    expect(BOARD_MEASURE_KEYS).toEqual(Object.keys(SEAS_MEASURES))
    const src = adapter('seasonality_board_read')
    expect(pyKind(src)).toBe(KINDS.board)
    expect(pyDict(src, 'WITHOUT_WORDS')).toEqual({ ...BOARD_WITHOUT_WORDS })
    expect(pyTuple(src, 'MONTH_FIELDS')).toEqual(plain(MONTHS()[0]))
    for (const key of plain(boardEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
    // the module holds no measure word of its own: every word it accepts is the panel's
    const own = fs.readFileSync(path.join(__dirname, 'capabilities', 'terminalDataWave6.js'), 'utf8')
    for (const word of ['AVG', 'MEAN', 'STOCKS', 'CALLS', 'PUTS']) expect(own.includes(`${word}:`), word).toBe(false)
  })
})

// ── options.tideHistory → stock.tideHistory ────────────────────────────────────────────────────────────────────────────
const trow = (session, call, put, prints, o = {}) => ({ session, net_call_premium: call, net_put_premium: put, net_premium: call == null || put == null ? null : call - put, prints_counted: prints, prints_unsigned: 12,
  prints_unreadable: 0, data_through: '16:00', stored_at: `${session}T21:30:00Z`, source: 'fixture', isolated: true, ...o })
const SESSIONS = () => [trow('2026-11-18', 5200000, 2100000, 2400), trow('2026-11-17', 1000000, 3500000, 1800), trow('2026-11-16', 4000000, 4000000, 2000, { prints_unreadable: 3 }),
  trow('2026-11-13', 2000000, 500000, 1500), trow('2026-11-12', 800000, 300000, 900), trow('2026-11-11', 600000, 100000, 700), trow('2026-11-10', 300000, 900000, 600)]
const tideEnv = (over = {}, envOver = {}) => envelope(KINDS.tide, {
  scope: 'all', sessions: SESSIONS(), sessions_stored: 7, sessions_asked: 20, sessions_left_out: 0, history_began: '2026-11-10', latest_session: '2026-11-18', missing_sessions: [], missing_total: 0,
  missing_checked_through: '2026-11-18', backfill: false, stored_note: 'fixture', filters: 'fixture', method: 'fixture', label: 'fixture', read_at: '2026-11-18T21:30:00Z', ...over,
}, envOver)

describe('stock.tideHistory — the answer', () => {
  it('the newest sessions by their own dates, the sums the panel offers, what is left out of a session, and that there is no backfill', () => {
    const env = tideEnv()
    const view = tideHistoryRead(env.data)                           // the kind's data IS the shape the panel reads
    expect(view).toMatchObject({ state: 'ok', scope: 'all', stored: 7, began: '2026-11-10', latest: '2026-11-18', backfill: false })
    const five = sumOver(view, 5)                                    // the panel's own sum: read, never retyped
    expect(five).toMatchObject({ ok: true, sum: 2600000, from: '2026-11-12', to: '2026-11-18' })
    const a = honest(answerFromTide(env))
    const lines = a.text.split('\n')
    expect(lines.slice(0, 2)).toEqual([
      'Market Tide by finished session, stocks and ETFs together: 7 sessions are stored, Nov 10, 2026 to Nov 18, 2026.',
      'The newest 5 of the 7 stored sessions, newest first (the older ones are left out):',
    ])
    expect(lines.slice(2, 7).map(l => l.split(':')[0])).toEqual(['• Wed, Nov 18, 2026', '• Tue, Nov 17, 2026', '• Mon, Nov 16, 2026', '• Fri, Nov 13, 2026', '• Thu, Nov 12, 2026'])
    expect(lines[2]).toBe(`• Wed, Nov 18, 2026: net ${a.facts.sessions[0].net_text} (net call premium ${a.facts.sessions[0].net_call_text}, net put premium ${a.facts.sessions[0].net_put_text}), 2,400 prints`)
    expect(lines[2]).toMatch(/net \+\$3\.1\dM|net \+\$3\.1M/)
    expect(lines[3]).toMatch(/^• Tue, Nov 17, 2026: net -\$2\.50?M /)
    expect(lines[4]).toMatch(/^• Mon, Nov 16, 2026: net \$0 .*, 2,000 prints, 3 left out$/)      // a net of nothing IS a figure: said as $0
    expect(lines.slice(7)).toEqual([
      `Net, last 5 sessions: ${five.text}.`,
      'Net, last 20 sessions: Needs 20 stored sessions; 7 are stored.',
      "Prints the tape could not read are left out of that session's figures.",
      'There is no backfill: the history starts on Nov 10, 2026, the first session UCT stored.',
      'Each row is a finished session; the newest is Wed, Nov 18, 2026. This is not the tide of a session still trading.',
      "The newest row was stored by UCT at Wed, Nov 18, 4:30 PM ET (UCT's own time).",
      `Source: ${TIDE_HISTORY_SOURCE}. ${DESCRIPTIVE}`,
    ])
    expect(a.facts).toMatchObject({ scope: 'all', scope_words: TIDE_SCOPES.all.words, stored: 7, read_rows: 7, shown: 5, left_out: 0, began: '2026-11-10', latest: '2026-11-18', latest_day: 'Wed, Nov 18, 2026',
      read: 'Wed, Nov 18, 4:30 PM ET', stale: false, backfill: false, missing: [], missing_total: 0 })
    expect(a.facts.sessions).toHaveLength(7)
    expect(a.facts.sessions[0]).toMatchObject({ session: '2026-11-18', net: 3100000, net_call: 5200000, net_put: 2100000, prints: 2400, unsigned: 12, unreadable: 0 })
    expect(a.facts.sums[0]).toMatchObject({ sessions: 5, ok: true, sum: 2600000, from: '2026-11-12', to: '2026-11-18' })
    expect(a.facts.sums[1]).toMatchObject({ sessions: 20, ok: false, sum: null, sum_text: null })
    expect(a.table.rows).toHaveLength(7)                             // the table carries every session read; the text names the newest five
    expect(a.table.rows[6].session).toBe('Nov 10, 2026')
    expect(a.present).toMatchObject({ kind: 'metrics', title: 'Market Tide by session, through Nov 18, 2026', short: 'Market Tide history' })
  })
  it('a session with no stored row is named as missing, never a zero, and a sum across it is refused in the panel\'s words', () => {
    const sessions = [SESSIONS()[0], SESSIONS()[1], SESSIONS()[3], SESSIONS()[4], SESSIONS()[5], SESSIONS()[6]]
    const env = tideEnv({ sessions, sessions_stored: 6, missing_sessions: ['2026-11-16'], missing_total: 1 })
    const a = honest(answerFromTide(env))
    expect(a.text).toContain('No tide was stored for Mon Nov 16: that session is missing, never a zero.')
    expect(a.text).toContain(`Net, last 5 sessions: ${sumOver(tideHistoryRead(env.data), 5).text}`)
    expect(a.facts.sums[0]).toMatchObject({ ok: false, sum: null })
    expect(a.facts).toMatchObject({ missing: ['2026-11-16'], missing_total: 1 })
    expect(a.text).not.toMatch(/Mon, Nov 16, 2026:/)
  })
  it('more missing sessions than the answer names are counted from the kind\'s own total, the newest named', () => {
    const missing = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']
    const a = honest(answerFromTide(tideEnv({ history_began: '2026-08-03', sessions_stored: 60, missing_sessions: missing, missing_total: 45 })))
    expect(a.text).toContain('No tide was stored for 45 trading sessions between the first and the last stored day (the newest: Mon Oct 5, Tue Oct 6, Wed Oct 7, Thu Oct 8, Fri Oct 9, Mon Oct 12): they are missing, never zeros.')
    expect(a.facts.missing_total).toBe(45)
    // fewer rows read than are stored: the sums that the rows read cannot carry are not offered at all (never "too few stored")
    expect(a.text).toContain('The newest 5 of the 60 stored sessions, newest first (the older ones are left out):')
    expect(a.facts).toMatchObject({ stored: 60, read_rows: 7, left_out: 53 })
    expect(a.facts.sums.map(s => s.sessions)).toEqual([5])
    expect(a.text).not.toMatch(/Needs 20 stored sessions/)
  })
  it('a figure the store does not hold is "not given", never $0; one stored session is said as one; an old newest session is stale', () => {
    const one = honest(answerFromTide(tideEnv({ sessions: [trow('2026-11-13', null, 500000, null)], sessions_stored: 1, history_began: '2026-11-13', latest_session: '2026-11-13', read_at: null, scope: 'etfs' }, { stale: true })))
    expect(one.text.split('\n')).toEqual([
      'Market Tide by finished session, ETFs and indexes only: 1 session is stored, Nov 13, 2026.',
      'The one stored session, newest first:',
      `• Fri, Nov 13, 2026: net not given (net call premium n/a, net put premium ${one.facts.sessions[0].net_put_text}), prints not given`,
      'There is no backfill: the history starts on Nov 13, 2026, the first session UCT stored.',
      'Stale: the newest stored session is Nov 13, 2026 and a later session has finished. This answer never captures one.',
      'Each row is a finished session; the newest is Fri, Nov 13, 2026. This is not the tide of a session still trading.',
      NO_TIME,
      `Source: ${TIDE_HISTORY_SOURCE}. ${DESCRIPTIVE}`,
    ])
    expect(one.facts.sessions[0]).toMatchObject({ net: null, net_text: null, net_call: null, net_call_text: null, prints: null })
    expect(one.facts.sums).toEqual([])
    expect(one.table.rows[0]).toMatchObject({ net: 'not given', call: 'not given', prints: 'not given' })
    expect(one.present.items).toEqual([])
  })
  it('nothing stored, refused and an unclean answer are never "no flow"', () => {
    expect(answerFromTide(UNAVAILABLE).text).toBe("I couldn't read the Market Tide history: no finished session is stored on the server yet (one is stored after each close, and this answer never captures one), or the read failed. No figure is stated. That is not the same as no flow.")
    expect(answerFromTide(REFUSED).text).toMatch(/^I couldn't read the Market Tide history: that request wasn't allowed for this question, so nothing was read\./)
    for (const bad of [{ sessions: null }, { sessions: [] }, { scope: 'banana' }, { sessions: [{ session: 'today' }] }]) {
      const a = honest(answerFromTide(tideEnv(bad)))
      expect(a.text, JSON.stringify(Object.keys(bad))).toBe("I couldn't read the Market Tide history: UCT's data did not answer cleanly. No figure is stated. That is not the same as no flow.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('a scope is read by the TIDEH panel\'s own word map; the scopes, the limits and the row fields are the kind\'s own (read from both files)', () => {
    for (const [word, key] of Object.entries(TIDE_SCOPE_ARG_WORDS)) {
      expect(scopeOf(word), word).toBe(key)
      expect(scopeOf(word.toLowerCase()), word).toBe(key)
    }
    for (const key of Object.keys(TIDE_SCOPES)) expect(scopeOf(key)).toBe(key)
    expect([scopeOf(null), scopeOf(undefined), scopeOf('')]).toEqual([DEFAULT_TIDE_SCOPE, DEFAULT_TIDE_SCOPE, DEFAULT_TIDE_SCOPE])
    expect([scopeOf('banana'), scopeOf('etf'), scopeOf(3), scopeOf('constructor')]).toEqual([null, null, null, null])
    const src = adapter('tide_history_read')
    expect(pyKind(src)).toBe(KINDS.tide)
    expect(pyTuple(src, 'SCOPES')).toEqual(TIDE_SCOPE_KEYS)
    expect(TIDE_SCOPE_KEYS).toEqual(Object.keys(TIDE_SCOPES))
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([TIDE_DEFAULT_ROWS, TIDE_MAX_ROWS])
    expect([TIDE_DEFAULT_ROWS, TIDE_MAX_ROWS]).toEqual([TIDE_ROWS_SHOWN, TIDE_SESSIONS_ASKED])
    expect(pyTuple(src, 'ROW_FIELDS')).toEqual(plain(SESSIONS()[0]))
    for (const key of plain(tideEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── options.oiChange → stock.oiChange ──────────────────────────────────────────────────────────────────────────────────
const orow = (contract, expiration, strike, type, oi, prior, volume) => ({ contract, expiration, strike, type, oi, kind: 'change', prior_oi: prior, change: oi - prior,
  change_pct: Math.round((oi - prior) / prior * 1000) / 10, volume, isolated: true })
const NEW_ROW = () => ({ contract: 'O:NVDA270115C00160000', expiration: '2027-01-15', strike: 160, type: 'call', oi: 300, kind: 'new', prior_oi: null, change: null, change_pct: null, volume: null, isolated: true })
const OI_ROWS = () => [orow('O:NVDA261120C00150000', '2026-11-20', 150, 'call', 11200, 10000, 3400), orow('O:NVDA261120P00140000', '2026-11-20', 140, 'put', 4500, 5000, 800), NEW_ROW(),
  orow('O:NVDA261218C00152500', '2026-12-18', 152.5, 'call', 2100, 2000, null)]
const oiEnv = (over = {}, envOver = {}) => envelope(KINDS.oi, {
  symbol: 'NVDA', side: 'any', session: '2026-11-18', prior_session: '2026-11-17', skipped_sessions: [], known: true, has_symbol: true, prior_has_symbol: true, rows: OI_ROWS(), matched: 4, shown: 4, left_out: 0,
  max_rows: 50, summary: { call: { contracts: 6, oi: 20000, prior_oi: 18700, change: 1300, isolated: true }, put: { contracts: 4, oi: 9000, prior_oi: 9500, change: -500, isolated: true }, contracts: 10, unchanged: 7, isolated: true },
  new: { contracts: 1, oi: 300, isolated: true }, gone: { contracts: 2, prior_oi: 150, expired: 1, isolated: true }, not_reported: 1, volume_present: true, volume_session: '2026-11-17',
  built_at: '2026-11-19T14:05:00+00:00', source: 'fixture', coverage: 'fixture', read_at: READ_AT, ...over,
}, { as_of: '2026-11-18T05:00:00Z', ...envOver })

describe('stock.oiChange — the answer', () => {
  it('the two log files by their own dates, each side\'s total, the changed and the new contracts (a new one never a change from 0), and what is left out', () => {
    const env = oiEnv()
    const view = oiChangeRead({ ...env.data, status: 'ok' })          // the kind's data IS the shape the panel reads
    expect(view).toMatchObject({ state: 'ok', session: '2026-11-18', priorSession: '2026-11-17', matched: 4, compared: 10, unchanged: 7, notReported: 1, volumePresent: true })
    const notes = Object.fromEntries(limitNotes(view, 'NVDA').map(n => [n.key, n.text]))   // the panel's own sentences: read, never retyped
    expect(Object.keys(notes)).toEqual(['new', 'gone', 'not-reported'])
    const a = honest(answerFromOi(env, 'NVDA'))
    expect(a.text.split('\n')).toEqual([
      "NVDA open interest change, calls and puts: UCT's options log of Wed, Nov 18, 2026 against Nov 17, 2026.",
      'The change is from trading on Tue Nov 17.',
      'Calls: +1,300 (18,700 to 20,000, over 6 calls).',
      'Puts: -500 (9,500 to 9,000, over 4 puts).',
      '7 of the 10 contracts in both records did not change.',
      'All 4 changed or new contracts, biggest first by number of contracts:',
      '• Nov 20 $150 call: +1,200 (+12.0%), 11,200 open interest, was 10,000, 3,400 traded on Tue Nov 17',
      '• Nov 20 $140 put: -500 (-10.0%), 4,500 open interest, was 5,000, 800 traded on Tue Nov 17',
      '• Jan 15, 2027 $160 call: new, 300 open interest, not in the earlier record',
      '• Dec 18 $152.50 call: +100 (+5.0%), 2,100 open interest, was 2,000',
      '1 contract is new: not in the Tue Nov 17 record, holding 300 open interest in the newer one. A new contract has no earlier figure, so it is stated as new, never as a change from 0, and is left out of the totals.',
      notes.gone,
      notes['not-reported'],
      'This compares two stored end-of-day files, the newer one dated Wed, Nov 18, 2026; it is not a reading of a session still trading.',
      `Put together by UCT ${READ_905}`,
      `Source: ${OI_CHANGE_SOURCE}. ${DESCRIPTIVE}`,
    ])
    expect(notes.new).toMatch(LIVE_WORDS)                             // why the panel's own "new" sentence is not echoed: it says "now"
    expect(notes.gone).toMatch(/^2 contracts from the Tue Nov 17 record are not in the newer one \(1 expired\)/)
    expect(a.facts).toMatchObject({ symbol: 'NVDA', known: true, side: 'any', side_words: 'calls and puts', session: '2026-11-18', session_day: 'Wed, Nov 18, 2026', prior_session: '2026-11-17', skipped_sessions: [],
      read: '9:05 AM ET', stale: false, matched: 4, read_rows: 4, shown: 4, left_out: 0, compared: 10, unchanged: 7, new_contracts: 1, new_open_interest: 300, gone_contracts: 2, gone_prior_open_interest: 150,
      gone_expired: 1, not_reported: 1, volume_present: true, volume_session: '2026-11-17' })
    expect(a.facts.calls).toEqual({ contracts: 6, open_interest: 20000, prior_open_interest: 18700, change: 1300 })
    // null, never 0: the new contract has no earlier figure, no change and no percent; a row with no volume has none
    expect(a.facts.rows[2]).toEqual({ contract: 'O:NVDA270115C00160000', expiration: '2027-01-15', strike: 160, type: 'call', kind: 'new', open_interest: 300, prior_open_interest: null, change: null, change_text: null,
      change_pct: null, volume: null, label: 'Jan 15, 2027 $160 call' })
    expect(a.facts.rows[3]).toMatchObject({ change: 100, change_text: '+100', change_pct: 5, volume: null })
    expect(a.table.rows[2]).toEqual({ contract: 'Jan 15, 2027 $160 call', change: 'new', pct: 'not given', oi: '300', prior: 'no earlier figure', volume: 'not given' })
    expect(a.table.rows[0]).toEqual({ contract: 'Nov 20 $150 call', change: '+1,200', pct: '+12.0%', oi: '11,200', prior: '10,000', volume: '3,400' })
    expect(a.present).toMatchObject({ kind: 'metrics', title: 'NVDA open interest change, Nov 18, 2026', short: 'NVDA open interest change' })
  })
  it('a cut list says how many there are and that the small end is cut; one side reads only its own total; a skipped session is said', () => {
    const rows = [...OI_ROWS(), orow('O:NVDA261120C00155000', '2026-11-20', 155, 'call', 1090, 1000, 10), orow('O:NVDA261120C00157500', '2026-11-20', 157.5, 'call', 1080, 1000, 10)].filter(r => r.type === 'call')
    const a = honest(answerFromOi(oiEnv({ side: 'call', rows, matched: 80, shown: 5, left_out: 75, skipped_sessions: ['2026-11-17'], prior_session: '2026-11-16', volume_present: false, volume_session: null }, { stale: true }), 'NVDA'))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe("NVDA open interest change, calls only: UCT's options log of Wed, Nov 18, 2026 against Nov 16, 2026.")
    expect(lines[1]).toBe('Calls: +1,300 (18,700 to 20,000, over 6 calls).')         // no "trading on" line across a skipped session, and no put total
    expect(a.text).not.toMatch(/^Puts:/m)
    expect(lines).toContain('The 5 biggest of the 80 changed or new calls, by number of contracts (the smaller ones are left out):')
    expect(lines).toContain('No record was stored for Tue Nov 17, so this compares against Mon Nov 16, the last stored day, and the change covers more than one session.')
    expect(lines).toContain('Volume is not stated: the earlier record carries none.')
    expect(lines).toContain('Stale: the newest file of the options log is Nov 18, 2026 and a later session has finished. This answer never fetches a newer file.')
    expect(a.text).not.toMatch(/traded on/)
    expect(a.facts).toMatchObject({ side: 'call', side_words: 'calls only', matched: 80, read_rows: 5, shown: 5, left_out: 75, skipped_sessions: ['2026-11-17'], stale: true, volume_present: false, volume_session: null })
    expect(a.facts.rows.every(r => r.volume === null)).toBe(true)     // no volume in the earlier record: null on every row, never the 10 the row carried
  })
  it('a stock in neither file is a healthy answer that says so: not a failed read, and not zero open interest', () => {
    const a = honest(answerFromOi(oiEnv({ known: false, has_symbol: false, prior_has_symbol: false, rows: [], matched: 0 }), 'ZZZZ'))
    expect(a.text.split('\n')).toEqual([
      "ZZZZ has no contract in either of the two newest files of UCT's options log (Nov 18, 2026 and Nov 17, 2026): no contract of it had an ask, open interest or volume in either. That is a statement about those two files, not a failed read, and it is not zero open interest.",
      `Put together by UCT ${READ_905}`,
      `Source: ${OI_CHANGE_SOURCE}. ${DESCRIPTIVE}`,
    ])
    expect(a.facts).toEqual({ symbol: 'ZZZZ', known: false, session: '2026-11-18', prior_session: '2026-11-17', side: 'any', read: '9:05 AM ET', stale: false, rows: [] })
    expect(a.table).toBeUndefined()
  })
  it('nothing changed is said in words with no table; a side with nothing in both records has no total, never 0', () => {
    const a = honest(answerFromOi(oiEnv({ rows: [], matched: 0, new: { contracts: 0, oi: null }, gone: { contracts: 0, prior_oi: null, expired: 0 }, not_reported: 0,
      summary: { call: { contracts: 3, oi: 500, prior_oi: 500, change: 0 }, put: { contracts: 0, oi: 0, prior_oi: 0, change: 0 }, contracts: 3, unchanged: 3 } }), 'NVDA'))
    expect(a.text).toContain('Calls: 0 (500 to 500, over 3 calls).')    // a real total of no change IS a figure
    expect(a.text).toContain('Puts: no put is in both records.')
    expect(a.text).toContain('No contract changed and none is new between the two records.')
    expect(a.facts.puts).toEqual({ contracts: 0, open_interest: null, prior_open_interest: null, change: null })
    expect(a.facts).toMatchObject({ new_contracts: 0, new_open_interest: null, gone_contracts: 0, gone_prior_open_interest: null })
    expect(a.table).toBeUndefined()
  })
  it('not prepared, refused and an unclean answer are never "no change"', () => {
    expect(answerFromOi(UNAVAILABLE, 'NVDA').text).toBe("I couldn't read NVDA's open interest change: the two newest files of UCT's options log are not prepared on the server at the moment (the open interest change panel prepares them, and this answer never does), or the log holds fewer than two days, or the read failed. Open NVDA's open interest change (OIC) in UCT, then ask again. No figure is stated. That is not the same as no change.")
    expect(answerFromOi(REFUSED, 'NVDA').text).toMatch(/^I couldn't read NVDA's open interest change: that request wasn't allowed for this question, so nothing was read\./)
    for (const bad of [{ rows: null }, { session: 'today' }, { prior_session: null }, { session: null }]) {
      const a = honest(answerFromOi(oiEnv(bad), 'NVDA'))
      expect(a.text, JSON.stringify(Object.keys(bad))).toBe("I couldn't read NVDA's open interest change: UCT's data did not answer cleanly. No figure is stated. That is not the same as no change.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('a side is read by the OIC panel\'s own word map; the sides, their words, the limits and the row fields are the kind\'s own (read from both files)', () => {
    for (const [word, key] of Object.entries(OI_SIDE_ARG_WORDS)) {
      expect(sideOf(word), word).toBe(key)
      expect(sideOf(word.toLowerCase()), word).toBe(key)
    }
    for (const key of Object.keys(OI_SIDES)) expect(sideOf(key)).toBe(key)
    expect([sideOf(null), sideOf(undefined), sideOf('')]).toEqual([DEFAULT_OI_SIDE, DEFAULT_OI_SIDE, DEFAULT_OI_SIDE])
    expect([sideOf('banana'), sideOf('both'), sideOf(3), sideOf('constructor')]).toEqual([null, null, null, null])
    const src = adapter('oi_change_read')
    expect(pyKind(src)).toBe(KINDS.oi)
    expect(pyTuple(src, 'SIDES')).toEqual(OI_SIDE_KEYS)
    expect(OI_SIDE_KEYS).toEqual(Object.keys(OI_SIDES))
    expect(pyDict(src, 'SIDE_WORDS')).toEqual({ ...OI_SIDE_WORDS })
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([OI_DEFAULT_ROWS, OI_MAX_ROWS])
    expect(OI_DEFAULT_ROWS).toBe(OI_ROWS_SHOWN)
    expect(pyTuple(src, 'ROW_FIELDS')).toEqual(plain(OI_ROWS()[0]))
    for (const key of plain(oiEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── rates.treasury → stock.treasuryYields ──────────────────────────────────────────────────────────────────────────────
const NO_BP = () => ({ d1: null, w1: null, m1: null, m3: null, y1: null })
const mat = (key, label, months, y, bp = {}) => ({ key, label, months, yield: y, was: { ...NO_BP(), isolated: true }, change_bp: { ...NO_BP(), ...bp, isolated: true }, isolated: true })
const MATURITIES = () => [mat('1m', '1-month', 1, null), mat('3m', '3-month', 3, 3.9, { d1: -1, m1: -12 }), mat('2y', '2-year', 24, 3.62, { d1: 3, m1: 8 }), mat('10y', '10-year', 120, 4.12, { d1: 7, m1: -18 }),
  mat('30y', '30-year', 360, 4.7, { d1: 0 })]
const spread = (key, short, value, o = {}) => ({ key, label: `10-year minus ${short === '2y' ? '2-year' : '3-month'}`, long: '10y', short, value, state: 'positive', inverted: false, days_in_state: 64, since: '2026-08-19',
  days_at_least: false, was: { ...NO_BP(), isolated: true }, change_bp: { ...NO_BP(), isolated: true }, isolated: true, ...o })
const SPREADS = () => [spread('10y2y', '2y', 0.5, { change_bp: { ...NO_BP(), w1: 7, m1: -18 } }), spread('10y3m', '3m', 0.22, { days_in_state: 1317, since: '2021-08-12', days_at_least: true })]
const ratesEnv = (over = {}, envOver = {}) => envelope(KINDS.treasury, {
  as_of: '2026-11-18', ref_dates: { d1: '2026-11-17', w1: '2026-11-11', m1: '2026-10-19', m3: '2026-08-18', y1: null, isolated: true }, maturities: MATURITIES(), spreads: SPREADS(),
  history: { from: '2021-08-12', to: '2026-11-18', points: 1317, years: 5, columns_left_out: true, isolated: true }, rows: 1317, read_at: READ_AT, basis: 'fixture', units: 'fixture', source: 'fixture', check: null, ...over,
}, { as_of: '2026-11-18T05:00:00Z', ...envOver })

describe('stock.treasuryYields — the answer', () => {
  it('each maturity by the curve\'s own date with its changes in basis points, the two spreads in the panel\'s sentences, and what has no figure', () => {
    const env = ratesEnv()
    const view = ratesRead({ ...env.data, status: 'ok' })             // the kind's data IS the shape the panel reads
    expect(view).toMatchObject({ state: 'ok', asOf: '2026-11-18', readAt: READ_AT, check: null })
    const a = honest(answerFromTreasury(env))
    expect(a.text.split('\n')).toEqual([
      'US Treasury yields by maturity, end-of-day figures for Wed, Nov 18, 2026:',
      '• 1-month: no figure for that day',
      '• 3-month: 3.90%, -1 bp from the day before, -12 bp from a month ago',
      '• 2-year: 3.62%, +3 bp from the day before, +8 bp from a month ago',
      '• 10-year: 4.12%, +7 bp from the day before, -18 bp from a month ago',
      '• 30-year: 4.70%, 0 bp from the day before',
      'The 10-year is 0.50 points above the 2-year: the curve is positive, for 64 trading days (since Aug 19, 2026). It is 7 bp steeper than a week ago and 18 bp flatter than a month ago.',
      'The 10-year is 0.22 points above the 3-month: the curve is positive, for at least 1,317 trading days (as far back as this screen reads, Aug 12, 2021).',
      'No figure was found near enough to a year ago, so that change is not stated: that is not a change of 0.',
      'The daily history behind the spreads is not in this answer: the Treasury yields panel (RATES) in UCT draws it.',
      END_OF_DAY,
      `Read by UCT from the Treasury's website ${READ_905}`,
      `Source: ${RATES_SOURCE}. ${DESCRIPTIVE}`,
    ])
    expect(a.facts).toMatchObject({ as_of: '2026-11-18', day: 'Wed, Nov 18, 2026', read: '9:05 AM ET', stale: false, check_failed: false, no_reference: ['y1'], missing: ['1-month'] })
    // null, never 0: the maturity with no figure, a change with no reference day; a real change of 0 bp IS a figure
    expect(a.facts.maturities[0]).toEqual({ key: '1m', label: '1-month', yield_pct: null, yield_text: null, was: NO_BP(), change_bp: NO_BP() })
    expect(a.facts.maturities[4]).toMatchObject({ yield_pct: 4.7, yield_text: '4.70%', change_bp: { d1: 0, w1: null, m1: null, m3: null, y1: null } })
    expect(a.facts.spreads[0]).toMatchObject({ key: '10y2y', value: 0.5, value_text: '+0.50', state: 'positive', days_in_state: 64, since: '2026-08-19', at_least: false })
    expect(a.facts.history).toEqual({ from: '2021-08-12', to: '2026-11-18', points: 1317, columns_left_out: true })
    expect(a.table.rows[0]).toEqual({ maturity: '1-month', yield: 'not given', d1: 'not given', w1: 'not given', m1: 'not given', m3: 'not given', y1: 'not given' })
    expect(a.table.rows[4]).toEqual({ maturity: '30-year', yield: '4.70%', d1: '0', w1: 'not given', m1: 'not given', m3: 'not given', y1: 'not given' })
    expect(a.table.columns.map(c => c.key)).toEqual(['maturity', 'yield', ...Object.keys(HORIZONS)])
    expect(a.present).toMatchObject({ kind: 'metrics', title: 'Treasury yields, Nov 18, 2026', short: 'Treasury yields' })
    expect(a.present.items.map(i => i.label)).toEqual(['3-month', '2-year', '10-year', '30-year'])
  })
  it('an inverted curve and a spread with a missing yield are said in the panel\'s own sentences', () => {
    const spreads = [spread('10y2y', '2y', -0.18, { state: 'inverted', inverted: true, days_in_state: 3, since: '2026-11-16' }), spread('10y3m', '3m', null, { state: null, days_in_state: null, since: null })]
    const a = honest(answerFromTreasury(ratesEnv({ spreads })))
    expect(a.text).toContain('The 10-year is 0.18 points below the 2-year: the curve is inverted, for 3 trading days (since Nov 16, 2026).')
    expect(a.text).toContain('The 10-year against the 3-month: no figure for Nov 18, 2026, because one of the two yields is missing.')
    expect(a.facts.spreads[1]).toMatchObject({ value: null, value_text: null, state: null, days_in_state: null })
  })
  it('a curve that is behind is stale; a look that went badly is said without the vendor\'s words; a missing read time is said', () => {
    const behind = honest(answerFromTreasury(ratesEnv({ as_of: '2026-11-13', read_at: null }, { stale: true })))
    expect(behind.text.split('\n').slice(-4)).toEqual([
      "Stale: the newest figure UCT holds is Nov 13, 2026, and a later day's figures may be out. This answer never looks for one.",
      END_OF_DAY,
      NO_TIME,
      `Source: ${RATES_SOURCE}. ${DESCRIPTIVE}`,
    ])
    const failed = honest(answerFromTreasury(ratesEnv({ check: { state: 'failed', reason: 'timeout 987654', http_status: 503, at: '2026-11-19T14:00:00+00:00', isolated: true } }, { stale: true })))
    expect(failed.text).toContain("Stale: UCT's last look for a newer figure did not go well, so these are the last figures it read and a newer day may exist.")
    expect(failed.text).not.toMatch(/timeout|503/)
    expect(failed.facts).toMatchObject({ stale: true, check_failed: true })
  })
  it('not held, refused and an unclean answer are never "no figure" for a maturity', () => {
    expect(answerFromTreasury(UNAVAILABLE).text).toBe("I couldn't read Treasury yields: none are held on the server at the moment (this answer never requests them from the Treasury's website), or the read failed. Open the Treasury yields panel (RATES) in UCT, then ask again. No figure is stated. That is not the same as no figure.")
    expect(answerFromTreasury(REFUSED).text).toMatch(/^I couldn't read Treasury yields: that request wasn't allowed for this question, so nothing was read\./)
    for (const bad of [{ as_of: 'today' }, { as_of: null }, { maturities: [] }, { maturities: MATURITIES().map(m => ({ ...m, yield: null })) }, { maturities: null }]) {
      const a = honest(answerFromTreasury(ratesEnv(bad)))
      expect(a.text, JSON.stringify(Object.keys(bad))).toBe("I couldn't read Treasury yields: UCT's data did not answer cleanly. No figure is stated. That is not the same as no figure.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the horizons and every field the answer reads are the kind\'s own and the RATES panel\'s own (read from both files)', () => {
    const src = adapter('treasury_read')
    expect(pyKind(src)).toBe(KINDS.treasury)
    expect(pyTuple(src, 'HORIZONS')).toEqual(TREASURY_HORIZON_KEYS)
    expect(TREASURY_HORIZON_KEYS).toEqual(Object.keys(HORIZONS))
    expect(Object.keys(pyDict(src, 'HORIZON_WORDS'))).toEqual(TREASURY_HORIZON_KEYS)
    for (const key of [...plain(ratesEnv().data), ...plain(MATURITIES()[0]), ...plain(SPREADS()[0]), 'columns_left_out']) expect(src.includes(`"${key}"`), key).toBe(true)
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
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the five kinds and the five capabilities, by name', () => {
    expect(KINDS).toEqual({ seasonality: 'seasonality.stock', board: 'seasonality.board', tide: 'options.tideHistory', oi: 'options.oiChange', treasury: 'rates.treasury' })
    expect(CAPABILITIES).toEqual({ seasonality: 'stock.seasonality', board: 'stock.seasonalityBoard', tide: 'stock.tideHistory', oi: 'stock.oiChange', treasury: 'stock.treasuryYields' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.season', 'group.drill', 'short.interest', 'short.list', 'cot.positioning', 'sectors.performance'], 'other kinds only']])('dark (%j, %s): none of the five is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave6Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave6Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all five served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
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
      expect(cap.hints, name).toMatch(/The date is the [^.]*: never today/)                        // the planner is told what the date is
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all five kinds of this wave are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments (a measure, a scope and a side read by the panels\' maps)', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.seasonality] = (p) => seasonEnv({ ticker: p.symbol })
    ENVS[KINDS.board] = () => boardEnv()
    ENVS[KINDS.tide] = (p) => tideEnv({ scope: p.scope })
    ENVS[KINDS.oi] = (p) => oiEnv({ symbol: p.symbol, side: p.side })
    ENVS[KINDS.treasury] = () => ratesEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.seasonality, { symbol: '$nvda' })).text).toMatch(/^NVDA by calendar month, close to close/)
    expect((await run(CAPABILITIES.seasonality, { symbol: 'brk.b' })).text).toMatch(/^BRK-B by calendar month/)
    expect((await run(CAPABILITIES.board, { measure: null })).text).toContain('the median November')
    expect((await run(CAPABILITIES.board, { measure: 'AVG' })).text).toContain('the average November')
    expect((await run(CAPABILITIES.tide, { scope: null, rows: null })).text).toMatch(/^Market Tide by finished session, stocks and ETFs together/)
    expect((await run(CAPABILITIES.tide, { scope: 'ETFS', rows: 999 })).text).toMatch(/^Market Tide by finished session, ETFs and indexes only/)
    expect((await run(CAPABILITIES.tide, { scope: 'stocks', rows: 3 })).text).toMatch(/^Market Tide by finished session, stocks only/)
    expect((await run(CAPABILITIES.oi, { symbol: 'nvda', side: null, rows: null })).text).toMatch(/^NVDA open interest change, calls and puts/)
    expect((await run(CAPABILITIES.oi, { symbol: '$tsla', side: 'PUTS', rows: 500 })).text).toMatch(/^TSLA open interest change, puts only/)
    expect((await run(CAPABILITIES.oi, { symbol: 'AMD', side: 'c', rows: 1 })).text).toMatch(/^AMD open interest change, calls only/)
    expect((await run(CAPABILITIES.treasury, {})).text).toMatch(/^US Treasury yields by maturity, end-of-day figures for Wed, Nov 18, 2026/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.seasonality, { symbol: 'NVDA' }, 'answer'],
      [KINDS.seasonality, { symbol: 'BRK-B' }, 'answer'],
      [KINDS.board, {}, 'answer'],
      [KINDS.board, {}, 'answer'],
      [KINDS.tide, { scope: 'all', rows: 20 }, 'answer'],
      [KINDS.tide, { scope: 'etfs', rows: 250 }, 'answer'],
      [KINDS.tide, { scope: 'stocks', rows: 3 }, 'answer'],
      [KINDS.oi, { symbol: 'NVDA', side: 'any', rows: 15 }, 'answer'],
      [KINDS.oi, { symbol: 'TSLA', side: 'put', rows: 50 }, 'answer'],
      [KINDS.oi, { symbol: 'AMD', side: 'call', rows: 1 }, 'answer'],
      [KINDS.treasury, {}, 'answer'],
    ])
  })

  it('no read without a turn or without a usable argument, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const GOOD = { [CAPABILITIES.seasonality]: { symbol: 'NVDA' }, [CAPABILITIES.board]: { measure: null }, [CAPABILITIES.tide]: { scope: null, rows: null }, [CAPABILITIES.oi]: { symbol: 'NVDA', side: null, rows: null },
      [CAPABILITIES.treasury]: {} }
    for (const name of ALL) expect((await getCapability(name).answer(null, GOOD[name], null)).text, name).toMatch(/needs the Agent's turn/)
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    for (const symbol of ['', 'the market', 'I:SPX', 'TOOLONGX', null]) {
      expect((await run(CAPABILITIES.seasonality, { symbol })).text, String(symbol)).toBe("Which stock's seasonality should I read? Give me one ticker. No figure is stated.")
      expect((await run(CAPABILITIES.oi, { symbol, side: null, rows: null })).text, String(symbol)).toBe("Which stock's open interest change should I read? Give me one ticker. No figure is stated.")
    }
    expect((await run(CAPABILITIES.board, { measure: 'banana' })).text).toBe('Which figure should I read the seasonality board by? Median month, Average month. No figure is stated.')
    expect((await run(CAPABILITIES.tide, { scope: 'banana', rows: null })).text).toBe('Which part of the options tape should I read the Market Tide history for? All, Stocks, ETFs. No figure is stated.')
    expect((await run(CAPABILITIES.oi, { symbol: 'NVDA', side: 'banana', rows: null })).text).toBe("Which side should I read NVDA's open interest change for? All, Calls, Puts. No figure is stated.")
    expect(reads()).toEqual([])
    const a = await run(CAPABILITIES.treasury, {})                     // the stub refuses
    expect(a.text).toMatch(/^I couldn't read Treasury yields: that request wasn't allowed for this question/)
    expect(reads()).toHaveLength(1)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const DATA_BASE = [...groupWords('data')]              // read before anything is served: routing.js's own lists
const SCREENER_BASE = [...groupWords('screener')]
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE6_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  seasonality: ['NVDA seasonality', 'seasonality for TSLA', 'how does AAPL usually do in december', 'best months for NVDA', 'what is the worst month for TSLA historically', 'is MSFT seasonally strong in november',
    'AMD seasonal pattern', 'how has NVDA typically done in january'],
  board: ['sector seasonality', 'seasonality board', 'which sectors usually do best in november', 'seasonality of the sector funds', 'index seasonality this month', 'how do the sectors typically do in december',
    'seasonal patterns across the sector ETFs', 'market seasonality for november'],
  tide: ['market tide history', 'market tide by day', 'market tide over the last week', 'how has the market tide been this week', 'market tide for the past 5 sessions', 'daily market tide',
    'what was the market tide yesterday', 'tide history for ETFs'],
  oi: ['open interest change on NVDA', 'where did TSLA open interest rise', 'new open interest in AAPL calls', 'which NVDA contracts added open interest', 'did open interest increase on AMD puts', 'NVDA oi change',
    'how did open interest change in TSLA yesterday', 'open interest build in NVDA calls'],
  treasury: ['treasury yields', 'what is the 10-year yield', 'is the yield curve inverted', '2s10s spread', 'where are bond yields', 'treasury rates', 'the 2 year yield', 'treasury curve',
    'how much did the 10 year yield move this month', 'has the curve inverted', '30-year treasury yield'],
}
/** another capability's language: none of the five's words may name these */
const NOT_OURS = [
  'market tide', 'show me the market tide', 'what is the market tide right now', 'market tide today', 'is the tide bullish',                                                               // the tide of the session still trading: not this answer
  'open interest on NVDA calls', 'NVDA open interest', 'what is the open interest at the 150 strike', 'put call ratio for SPY', 'options chain for NVDA',                              // open interest with no change asked, the chain
  'are specs net short gold', 'open interest change in gold futures', 'did open interest rise in crude oil', 'net short positioning in treasury futures', 'how are commercials positioned in the 10-year note',
  'open interest in the S&P futures rose', 'cot report for treasuries', 'did open interest increase in the yen',                                                                         // cot.positioning (its group names open interest)
  'dividend yield on KO', 'highest dividend yield stocks', 'what is the yield on JNJ', 'interest rates today', "what is the flow record's win rate", 'fed rate decision', 'earnings yield on AAPL', 'success rates of the top flow picks',
  'NVDA monthly returns in 2024', 'best month for NVDA in 2023', 'how did TSLA do in march 2025', 'best stocks this month', 'best performing stocks in november',                        // a named year, a leaderboard
  'sector performance this month', 'which sectors are leading', 'best sectors this week', 'how did the sectors do today', 'stocks in the technology sector',                            // stock.sectorPerformance, stock.groupDrill
  'how does NVDA usually trade after earnings', 'what usually happens after a gap up', 'NVDA 5 year return', 'the 10 year chart of AAPL', 'yearly highs today',                         // "usually" with no month, a maturity with no yield
  'find stocks with strong november seasonality', 'scan for seasonal winners', 'screen for open interest change above 20%', 'alert me when the yield curve inverts', 'notify me if open interest rises on GME',
  'add a seasonality widget', 'open the treasury yields panel', 'go to the market tide history page', 'treasury yields on my watchlist', 'seasonality of my watchlist',              // screens, alerts, navigation, the member's lists
  'what is seasonality', 'explain the yield curve', 'what does open interest mean', "what's market tide", 'define par yield', 'how is market tide history calculated', 'what is the yield curve', 'what is open interest',
  'short interest on NVDA', 'most shorted stocks', 'dark pool levels on NVDA', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings season today', 'what are CEOs saying',   // waves 1 to 5
  'any news on TSLA', 'switch to weekly', 'what got upgraded today', 'which stocks made new 52-week highs', 'most active stocks today', 'top gainers today', 'compare nvda with amd', 'NVDA relative strength',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'which stocks made new 52-week highs', 'which themes are rotating in',
  'what is on the confluence board', 'bearish confluence names', 'expected move for NVDA earnings', 'search earnings calls for pricing power', 'gamma levels for NVDA', 'show me the top flow picks',
  "what is the flow record's win rate", 'earnings reactions for yesterday', 'earnings season today', 'call themes this month', 'drill into XLK', 'stocks in the semiconductors industry',
  'short interest on NVDA', 'most shorted stocks', 'NVDA days to cover']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the five by action with no word of its own, and it is the 48th group', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups: this wave's is the 48th, the last of the 48 kept when it was built. Wave 7's build
    // raised the cap to 56 on 2026-11-20 for its own group (agentTerminalDataWave7.test.js pins the count as it stands)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([48, 56, true])
    expect(GROUPS.map(x => x.id).slice(45, 48)).toEqual([WAVE4_GROUP, WAVE5_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    // no action of this wave is in any other group's list
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.season', 'group.drill', 'short.interest', 'cot.positioning'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data and screener groups keep exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE6_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    expect([groupWords(WAVE4_GROUP), groupWords(WAVE5_GROUP), groupWords('cot')]).toEqual([[], [], []])
    // the OTHER four's asks are not sent to the group while only this one is served
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave6Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE6_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE6_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
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

  it('the nearest neighbours keep their own asks: COT\'s open interest and Treasury positioning, sector performance, a dividend yield, win rates, a bare "market tide"', async () => {
    wire([...PAIRS.map(p => p[0]), COT_KIND, 'sectors.performance', 'flow.record', 'screen.run'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    expect(allCapabilityNames()).toEqual(expect.arrayContaining([COT_CAPABILITY, 'stock.sectorPerformance', 'stock.flowRecord']))    // non-vacuity: the neighbours are registered
    // COT's own words still name its asks (open interest and positioning in a FUTURES market), and this wave's group does not ride
    for (const q of ['open interest in gold futures', 'did open interest rise in crude oil', 'net short positioning in treasuries', 'how are specs positioned in the 10-year', 'open interest change in gold futures']) {
      expect(selectGroups(q).selected, q).toContain('cot')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        expect(names, `${route.name}: ${q}`).toContain(COT_CAPABILITY)
        expect(names, `${route.name}: ${q}`).not.toContain(CAPABILITIES.oi)
      }
    }
    // a stock's open interest change and the Treasury curve are this wave's, and COT does not ride with them under v1
    for (const q of ['open interest change on NVDA', 'treasury yields', 'is the yield curve inverted', 'where are bond yields']) {
      expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
      expect(selectGroups(q).selected, q).not.toContain('cot')
    }
    // sector performance over a recent period reaches its own capability, never the seasonality board
    for (const q of ['sector performance this month', 'which sectors are leading']) {
      for (const route of [routeManifest, routeManifestV2]) expect(route(full, q, ROUTE_OPTS()).manifest.map(c => c.name), `${route.name}: ${q}`).toContain('stock.sectorPerformance')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // the Flow Record's win rates stay wave 3's
    expect(selectGroups("what is the flow record's win rate").selected).not.toContain(ROUTE_GROUP)
    // "yield", "rates", "tide", "seasonal", "open interest" alone select nothing of this wave under v1
    for (const q of ['yield', 'rates', 'yields', 'market tide', 'tide', 'open interest', 'curve', 'dividend yield', 'win rate', 'interest rates']) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'show me the leaders', 'both', 'hmm', 'market tide', 'rates']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  const FIXED_WORDS = ['etfs', 'median', 'seasonality', 'tide', 'treasury', 'yields']
  it('the typo lexicon: registering the five changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out,
    // and so are the LATER waves' (7 to 9): they were written with this wave's words already known ("treasury", "yields"),
    // and each later wave pins its own corrections in its own test file (agentTerminalDataWave7/8/9.test.js).
    const LATER = new Set([...Object.values(WAVE7_CAPS), ...Object.values(WAVE8_CAPS), ...Object.values(WAVE9_CAPS)])
    expect(LATER.size).toBe(12)
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id) && !LATER.has(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'make it shorter', 'sorted results', 'hover over it', 'recover the layout', 'floating window', 'rank them', 'interesting names today', 'whats the reprot date',
      'the newst one', 'offen', 'the sme one', 'bset setups', 'frist one', 'munth view', 'each one', 'ago', 'weak names', 'the bord', 'yeild', 'curv', 'sesonal', 'maturity', 'a yaer', 'monts', 'quoet',
      'avrage', 'stoks', 'calender', 'weekdya', 'sesion', 'backfil', 'contrat', 'basis ponts', 'spraed', 'positoning', 'dividned']
    const read = () => { const lex = lexiconFor(null); return texts.map(t => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))) }
    const before = read()
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    // the ONLY words the five add to the lexicon are words of their own NAMES and two of the panels' own argument keys
    // (the SEASB measure `median`, the TIDEH scope `etfs`): a name and an argument's value are fixed. A summary's and a
    // hint's other words are either already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(FIXED_WORDS)
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
    const earlier = [namedBy(TERMINAL_ROUTE_WORDS), namedBy(WAVE2_ROUTE_WORDS), namedBy(WAVE3_ROUTE_WORDS), namedBy(WAVE4_ROUTE_WORDS), namedBy(WAVE5_ROUTE_WORDS)]
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(earlier.flatMap(f => f(q)), q).toEqual([])
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
