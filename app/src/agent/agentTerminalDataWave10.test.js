// Terminal data wave 10 — six LOCAL-ONLY capabilities over six model-isolated kinds (MD-1 §4.19):
//   stock.riskProfile ← stock.stats · stock.volumeFootprint ← stock.volumeFootprint · stock.factorExposure ← stock.factorExposure ·
//   stock.setupHistory ← stock.setupHistory · stock.companyRecord ← company.publicRecords · stock.ownershipReport ← ownership.funds.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date (the newest session's close, a fund's report period, each record section's read time) and when UCT worked it
// out, never calls a missing number 0, says when a list is cut and from which end, never calls "not held" or a failed read
// "none", says "no record matched" and never that no record exists, never names the price studies' vendor, and never echoes an
// envelope note. Routing: the six share ONE words-only group of their own (`stockStudies`, the 52nd of the 56 the server
// keeps). Each capability's own words are armed only while it is registered, and they never name another capability's
// language: implied volatility, a stock's drawdowns or an event study (the data group), the confirmed setups, the playbook, a
// screen, the market's distribution days, options contracts, FDA news, hedge funds, alerts, navigation and what a term means.
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
import { _resetTerminalWave9ForTest, WAVE9_ROUTE_WORDS, ROUTE_GROUP as WAVE9_GROUP } from './capabilities/terminalDataWave9'
import {
  KINDS, CAPABILITIES, NOT_ADVICE, STATS_DEFAULT_ROWS, STATS_MAX_ROWS, STATS_RECORD, STATS_LEFT_OUT, CORRECTION_STATE_WORDS,
  FOOTPRINT_DEFAULT_ROWS, FOOTPRINT_MAX_ROWS, FOOTPRINT_RECORD, FOOTPRINT_LEFT_OUT, FACTORS_RECORD, FACTORS_LEFT_OUT,
  SETUPS_DEFAULT_ROWS, SETUPS_MAX_ROWS, SETUPS_RECORD, SETUPS_HINDSIGHT, UNIVERSE_STATE_WORDS,
  RECORDS_DEFAULT_ROWS, RECORDS_MAX_ROWS, RECORD_SECTIONS, RECORD_TITLES, RECORDS_RECORD, RECORD_NOT_HELD,
  FUNDS_DEFAULT_ROWS, FUNDS_MAX_ROWS, FUNDS_RECORD,
  answerFromStats, answerFromFootprint, answerFromFactors, answerFromSetups, answerFromRecords, answerFromFunds,
  registerTerminalWave10Capabilities, _resetTerminalWave10ForTest, WAVE10_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave10'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([\\s\\S]+?)\\)$`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const pyKind = (src) => /^KIND = "([\w.]+)"/m.exec(src)[1]
const FETCHED = '2031-06-04T15:30:00Z'               // 11:30 AM ET, a Wednesday: the day of the read
const READ_AT = '2031-06-03T00:40:00Z'               // 8:40 PM ET the evening before
const NOTE = 'a provider note that must never be echoed 987654'
const plain = (o) => Object.keys(o).filter(k => k !== 'isolated')
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2031-06-02T20:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
/** the price studies' vendors: an answer never names them */
const VENDORS = /\b(?:massive|polygon|finnhub|fmp|financial modeling prep|yahoo|yfinance)\b/i
/** every answer of this wave: no live / now wording, never an envelope note, never a vendor's name, and never the day of the
 *  read as the data's date (the day of the read, Jun 4, 2031, appears nowhere) */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(VENDORS)
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Jun 4, 2031|2031-06-04/i)
  return a
}
const lines = (a) => a.text.split('\n')

// ── stock.stats → stock.riskProfile ────────────────────────────────────────────────────────────────────────────────────
const period = (key, label, from, ret, yearly) => ({ key, label, target: from, state: 'ok', from, base_close: 10, return_pct: ret, ...(yearly == null ? {} : { yearly_pct: yearly }), isolated: true })
const drawdown = (peak, trough, depth, recovered) => ({ id: `QZSA-${peak}`, peak: { date: peak, close: 50 }, trough: { date: trough, close: 30 }, depth_pct: depth, sessions_down: 40,
  recovered, sessions_to_recover: recovered ? 90 : null, ongoing: !recovered, peak_at_history_start: false, below_peak_now_pct: recovered ? null : -12.0, check: false, isolated: true })
const statsData = (over = {}) => ({
  symbol: 'QZSA', session: '2031-06-02', data_through: '2031-06-02', first: '2027-01-04', sessions: 1110, read_at: READ_AT,
  source: 'UCT stored daily prices (invented)', basis: 'invented basis words', suspect_jump_pct: 40, suspect_jumps: [],
  volatility: { as_of: '2031-06-02', close: 41.25, sessions: 1110, atr: { state: 'ok', period: 14, value: 1.2345, pct: 2.99 },
    realized: [{ state: 'ok', sessions: 20, pct: 38.4 }, { state: 'ok', sessions: 60, pct: 41.2 }], realized_method: 'invented',
    adr: { state: 'ok', sessions: 21, pct: 3.41, dollars: 1.3 },
    range_52w: { state: 'ok', high: 48.5, high_date: '2031-03-14', low: 30.1, low_date: '2030-08-08', from_high_pct: -14.95, from_low_pct: 37.04 },
    volume: { last: 1200000, last_date: '2031-06-02', avg: { 20: 1500000, 50: 1400000 }, rel: 0.8, rel_base_sessions: 30 },
    days_1y: { state: 'ok', from: '2030-06-02', total: 251, up: 130, down: 118, flat: 3, up_pct: 51.8, down_pct: 47.0 } },
  beta: { as_of: '2031-06-02', window: 252, min: 200, capture_min_days: 20,
    spy: { symbol: 'SPY', state: 'ok', returns: 252, from: '2030-06-02', to: '2031-06-02', beta: 1.42, correlation: 0.71, up_capture: 131.5, up_capture_days: 133, down_capture: 118.2, down_capture_days: 119 },
    sector: { state: 'not_held', symbol: 'XLK', sector: 'Technology' } },
  returns: { as_of: '2031-06-02', close: 41.25, week_complete: true,
    periods: [period('1W', '1 week', '2031-05-26', 3.13), period('1M', '1 month', '2031-05-02', -2.4), period('3M', '3 months', '2031-03-02', 8.9), period('6M', '6 months', '2030-12-02', 12.0),
      period('YTD', 'Year to date', '2030-12-31', 15.5), period('1Y', '1 year', '2030-06-02', 21.7), period('3Y', '3 years', '2028-06-02', 60.2, 17.0),
      { key: '5Y', label: '5 years', target: '2026-06-02', state: 'short', needed_from: '2026-06-02', held_from: '2027-01-04' }],
    extremes: {} },
  drawdowns: { as_of: '2031-06-02', first: '2027-01-04', min_depth_pct: 20, high: { date: '2031-03-14', close: 48.1, from_high_pct: -14.24 }, total: 3, shown: 2,
    ongoing: 1, recovered: 2, median_depth_pct: -31.2, median_recovery_sessions: 140, deepest: drawdown('2029-02-01', '2029-04-02', -38.5, '2029-11-01'),
    episodes: [drawdown('2031-03-14', '2031-05-01', -22.0, null), drawdown('2029-02-01', '2029-04-02', -38.5, '2029-11-01')] },
  corrections: { index: 'S&P 500', first: '2027-01-04', as_of: '2031-06-02', state: 'ok', index_first: '1990-01-02', index_through: '2031-06-02', built_at: '2031-06-03T00:20:00Z',
    definition: 'invented definition', before_history: 6,
    summary: { count: 4, fell_less: 1, fell_more: 3, median_ratio: 1.6, new_high_first: 1, new_high_judged: 3, after_beat: 2, after_count: 3, median_after_vs_index_pts: 4.2 } },
  stale_for: [], left_out: ['correction_episodes'], ...over,
})
const statsEnv = (over = {}, envOver = {}) => envelope(KINDS.stats, statsData(over), envOver)

describe('stock.riskProfile — the answer', () => {
  it('volatility, beta, returns, its own declines and the corrections line, each as the server worked it out, with the data\'s own date', () => {
    const a = honest(answerFromStats(statsEnv(), 'QZSA'))
    const l = lines(a)
    expect(l[0]).toBe("QZSA's statistics as UCT holds them, from its stored daily prices (1110 sessions, Mon, Jan 4, 2027 to Mon, Jun 2, 2031):")
    expect(l).toContain('• Against SPY: 1.42, correlation 0.71; up capture 132% (on 133 up days), down capture 118% (on 119 up days)'.replace('on 119 up days', 'on 119 down days'))
    expect(l).toContain('• Against Technology (XLK): UCT holds no prices for XLK on this server.')
    expect(l.find(x => x.startsWith('Returns: '))).toContain('3 years +60.2% (+17.0% a year)')
    expect(l.find(x => x.startsWith('Returns: '))).toContain('5 years n/a')
    expect(l).toContain('5 years reaches back past the prices UCT holds, so it is not stated: that is not a return of 0.')
    expect(l.find(x => x.startsWith('Its own declines: '))).toContain('3 declines of 20% or more')
    expect(l).toContain('3 declines are held and the newest 2 are in this answer: the list is cut from the old end.')
    expect(l.find(x => x.startsWith("In the S&P 500's corrections: "))).toContain('it fell less than the index in 1 and more in 3')
    expect(l.slice(-3)).toEqual([STATS_RECORD, STATS_LEFT_OUT, "UCT worked these out at Mon, Jun 2, 8:40 PM ET (UCT's own time), and this answer never works these out again."])
    expect(a.facts).toMatchObject({ symbol: 'QZSA', as_of: '2031-06-02', stale: false, beta: { spy: 1.42, sector: null, sector_state: 'not_held' } })
    expect(a.facts.returns['5Y']).toBeNull()
    expect(a.table.rows.find(r => r.period === '5 years')).toEqual({ period: '5 years', value: 'n/a', note: 'not enough history' })
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'Stock statistics' })
    expect(STATS_RECORD).toContain(NOT_ADVICE)
  })
  it('a statistic too short is words never 0, a corrections block not held is said, a stale answer is said and never worked out again', () => {
    const short = honest(answerFromStats(statsEnv({ volatility: { ...statsData().volatility, atr: { state: 'short', needed: 15, held: 9, unit: 'sessions' } },
      corrections: { index: 'S&P 500', first: '2027-01-04', as_of: '2031-06-02', state: 'computing' } }), 'QZSA'))
    expect(lines(short)).toContain('• ATR (14): Needs 15 sessions; UCT holds 9.')
    expect(lines(short)).toContain(`In the S&P 500's corrections: ${CORRECTION_STATE_WORDS.computing}`)
    expect(short.text).not.toMatch(/\$0\.00|\b0\.0%/)
    const stale = honest(answerFromStats(statsEnv({ session: '2031-05-30', data_through: '2031-05-29', stale_for: ['earlier_session', 'closes_short'] }, { stale: true }), 'QZSA'))
    expect(stale.text).toContain('Stale: UCT worked these out for the session of Fri, May 30, 2031, and a newer session has closed since. This answer never works these out again: open STAT for QZSA in UCT, then ask again.')
    expect(stale.text).toContain('Stale: the newest close UCT held for QZSA (Thu, May 29, 2031) stops short of the session they were worked out for: the store had not caught up, or the stock did not trade.')
  })
  it('not held, refused, an unclean answer and a missing ticker are never "no statistics"', () => {
    expect(answerFromStats(UNAVAILABLE, 'QZSA').text).toBe("I couldn't read QZSA's statistics: none are held on the server yet (this answer never works them out), or the read failed. Open STAT for QZSA in UCT, then ask again. No statistic is stated. That is not the same as no statistics.")
    expect(answerFromStats(REFUSED, 'QZSA').text).toBe(`I couldn't read QZSA's statistics: ${REFUSED_WORDS}. No statistic is stated. That is not the same as no statistics.`)
    for (const bad of [{ data_through: null }, { beta: null }, { returns: { periods: null } }]) {
      const a = honest(answerFromStats(statsEnv(bad), 'QZSA'))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read QZSA's statistics: UCT's data did not answer cleanly. No statistic is stated. That is not the same as no statistics.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the limits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('stock_stats_read')
    expect(pyKind(src)).toBe(KINDS.stats)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([STATS_DEFAULT_ROWS, STATS_MAX_ROWS])
    for (const key of plain(statsEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
    expect(Object.keys(CORRECTION_STATE_WORDS).sort()).toEqual(Object.keys(JSON.parse(`{${/^CORRECTION_WORDS = \{([\s\S]+?)\}$/m.exec(src)[1].match(/"(\w+)":/g).map(s => `${s}0`).join(',')}}`)).sort())
  })
})

// ── stock.volumeFootprint → stock.volumeFootprint ──────────────────────────────────────────────────────────────────────
const fill = (count, open) => ({ count, open, within_5: { filled: count - open, judged: count, pct: count ? 50.0 : null }, within_20: { filled: count - open, judged: count, pct: count ? 75.0 : null },
  earnings: 0, earnings_known: count })
const footprintData = (over = {}) => ({
  symbol: 'QZSA', session: '2031-06-02', data_through: '2031-06-02', first: '2027-01-04', sessions: 1110, read_at: READ_AT, source: 'invented', basis: 'invented', suspect_jump_pct: 40,
  earnings: { state: 'not_held', source: 'invented' },
  accumulation: { as_of: '2031-06-02', min_move_pct: 0.2, windows: [{ state: 'ok', sessions: 25, from: '2031-04-28', accumulation: 7, distribution: 4, net: 3, not_judged: 0 },
    { state: 'ok', sessions: 50, from: '2031-03-21', accumulation: 12, distribution: 14, net: -2, not_judged: 1 }],
    updown: { state: 'ok', sessions: 50, from: '2031-03-21', up_volume: 41000000, down_volume: null, up_sessions: 27, down_sessions: 22, flat_sessions: 0, no_volume: 1, ratio: null } },
  pivots: { as_of: '2031-06-02', from: '2030-06-02', full_year: true, held_from: '2027-01-04', lookback: 10, ma: 10, state: 'ok', judged_from: '2030-06-03', count: 9, up_days: 130,
    not_judged: 0, earnings: 1, rows: [{ date: '2031-05-27', change_pct: 3.4, volume: 2100000, down_max: 1500000, vs_down_max: 1.4, ma: 40.1, above_ma_pct: 2.1, earnings: false }], last: '2031-05-27' },
  gaps: { as_of: '2031-06-02', first: '2027-01-04', min_gap_pct: 3.0, windows: [5, 20], shown_max: 60, state: 'ok', total: 12, shown: 1,
    rows: [{ date: '2031-05-20', up: true, gap_pct: 4.1, prior_date: '2031-05-19', prior_close: 39.0, open: 40.6, close: 41.0, close_vs_open_pct: 1.0, filled: null, sessions_to_fill: null, sessions_since: 9, earnings: null, check: false }],
    summary: { all: fill(12, 3), up: fill(8, 2), down: fill(4, 1) } },
  stale_for: [], left_out: ['big_days', 'ad_days'], ...over,
})
const footprintEnv = (over = {}, envOver = {}) => envelope(KINDS.footprint, footprintData(over), envOver)

describe('stock.volumeFootprint — the answer', () => {
  it('the 25 and 50 session counts, up/down volume, pocket pivots and gaps with their fill shares, each the server\'s own', () => {
    const a = honest(answerFromFootprint(footprintEnv(), 'QZSA'))
    const l = lines(a)
    expect(l[0]).toBe("QZSA's volume footprint as UCT holds it, from its stored daily bars through Mon, Jun 2, 2031 (a close at least 0.2% up or down on more volume than the session before):")
    expect(l).toContain('• Last 25 sessions: 7 accumulation days, 4 distribution days: net +3')
    expect(l).toContain('• Last 50 sessions: 12 accumulation days, 14 distribution days: net -2; 1 session not judged (no volume held)')
    expect(l).toContain('• Up/down volume over 50 sessions: No ratio: 1 session that moved has no volume held.')
    expect(l.find(x => x.startsWith('• Pocket pivots: '))).toContain('9 pocket pivots')
    expect(l).toContain('  9 pocket pivots are held for the last year and the newest 1 are in this answer: the list is cut from the old end.')
    expect(l).toContain('  Filled within 5 sessions: 50% (9 of 12); within 20 sessions: 75% (9 of 12).')
    expect(l).toContain('  12 gaps are held and the newest 1 are in this answer: the list is cut from the old end.')
    expect(l.slice(-3)).toEqual([FOOTPRINT_RECORD, FOOTPRINT_LEFT_OUT, "UCT worked it out at Mon, Jun 2, 8:40 PM ET (UCT's own time), and this answer never works it out again."])
    expect(a.facts).toMatchObject({ as_of: '2031-06-02', updown_ratio: null, pivots: { state: 'ok', count: 9, last: '2031-05-27' }, gaps: { total: 12, up: 8, down: 4, open: 3 } })
    expect(a.facts.windows.map(w => w.net)).toEqual([3, -2])
  })
  it('not held, refused and an unclean answer are never "no accumulation"', () => {
    expect(answerFromFootprint(UNAVAILABLE, 'QZSA').text).toBe("I couldn't read QZSA's volume footprint: it is not held on the server yet (this answer never works it out), or the read failed. Open VFP for QZSA in UCT, then ask again. No count is stated. That is not the same as no accumulation and no gaps.")
    expect(answerFromFootprint(REFUSED, 'QZSA').text).toBe(`I couldn't read QZSA's volume footprint: ${REFUSED_WORDS}. No count is stated. That is not the same as no accumulation and no gaps.`)
    for (const bad of [{ accumulation: null }, { gaps: 'x' }, { data_through: 'soon' }]) {
      expect(honest(answerFromFootprint(footprintEnv(bad), 'QZSA')).text, JSON.stringify(bad)).toMatch(/^I couldn't read QZSA's volume footprint: UCT's data did not answer cleanly\./)
    }
  })
  it('the limits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('volume_footprint_read')
    expect(pyKind(src)).toBe(KINDS.footprint)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([FOOTPRINT_DEFAULT_ROWS, FOOTPRINT_MAX_ROWS])
    for (const key of plain(footprintEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
    expect(src.includes('pivots["last"]')).toBe(true)
  })
})

// ── stock.factorExposure → stock.factorExposure ────────────────────────────────────────────────────────────────────────
const loading = (key, l, t, clears, extra = {}) => ({ key, loading: l, se: 0.1, t, clears, correlation: 0.5, vif: 2.1, isolated: true, ...extra })
const factorsData = (over = {}) => ({
  symbol: 'QZSA', session: '2031-06-02', data_through: '2031-06-02', read_from: '2029-04-01', sessions_read: 564, read_at: READ_AT, source: 'invented', basis: 'invented', suspect_jump_pct: 40,
  method: { window: 252, min: 200, t_bar: 2.0, vif_unstable: 5.0, fund_min_closes: 201, fund_full_closes: 505, index: 'S&P 500', annualise_days: 252, max_lag_days: 10 },
  factors: [{ key: 'market', name: 'Market', state: 'ok', funds: ['SPY'], primary: ['SPY'], alternative: ['IVV'] }, { key: 'size', name: 'Size', state: 'substituted', funds: ['VTWO', 'SPY'], primary: ['IWM'], alternative: ['VTWO'] },
    { key: 'growth', name: 'Growth vs value', state: 'ok', funds: ['IWF', 'IWD'], primary: ['IWF', 'IWD'], alternative: ['VUG', 'VTV'] }, { key: 'momentum', name: 'Momentum', state: 'ok', funds: ['MTUM', 'SPY'], primary: ['MTUM'], alternative: ['SPMO'] },
    { key: 'quality', name: 'Quality', state: 'dropped', funds: null, primary: ['QUAL'], alternative: ['SPHQ'] }, { key: 'lowvol', name: 'Low volatility', state: 'ok', funds: ['USMV', 'SPY'], primary: ['USMV'], alternative: ['SPLV'] }],
  common_returns: 520, common_from: '2029-04-02', common_to: '2031-06-02',
  now: { state: 'ok', returns: 252, from: '2030-06-02', to: '2031-06-02', full: true, exact: false,
    loadings: [loading('market', 1.31, 12.4, true, { t_vs_one: 2.9, side: 'more' }), loading('size', 0.05, 0.4, false), loading('growth', 0.88, 3.1, true), loading('momentum', 0.71, 2.6, true), loading('lowvol', 0.02, null, false)],
    constant: { daily_pct: 0.021, yearly_pct: 5.3, t: 0.9, clears: false }, r2: 0.61, adj_r2: 0.6, explained_pct: 61.0, own_pct: 39.0,
    volatility: { total_pct: 42.0, factors_pct: 32.8, own_pct: 26.2 }, market_beta_alone: 1.36, max_vif: { key: 'momentum', value: 6.4 }, unstable: true, check: [] },
  reading: { text: 'QZSA trades like a high-momentum growth stock with more market sensitivity than the S&P 500.', basis: [], uncertain: ['size', 'lowvol'], exact: false },
  stale_for: [], left_out: ['then', 'change', 'reading_then', 'fund_checks'], ...over,
})
const factorsEnv = (over = {}, envOver = {}) => envelope(KINDS.factors, factorsData(over), envOver)

describe('stock.factorExposure — the answer', () => {
  it('the server\'s reading, each loading with its t and whether it clears the bar, R-squared and the VIF warning', () => {
    const a = honest(answerFromFactors(factorsEnv(), 'QZSA'))
    const l = lines(a)
    expect(l[1]).toBe("The server's reading: QZSA trades like a high-momentum growth stock with more market sensitivity than the S&P 500.")
    expect(l).toContain('• Market: +1.31 (t 12.4, above 2)')
    expect(l).toContain('• Size: +0.05 (t 0.4, too uncertain)')
    expect(l).toContain('• Low volatility: +0.02 (no t: an exact fit)')
    expect(l.find(x => x.startsWith('Explained by the factors: '))).toContain('61.0% of its daily variance (R-squared 0.61')
    expect(l.find(x => x.startsWith('The factors overlap: '))).toContain('above 5, so these loadings are unstable')
    expect(l.find(x => x.startsWith('Alternative funds used: '))).toContain('Left out of the model, no fund held with enough history: quality.')
    expect(l.slice(-3)).toEqual([FACTORS_RECORD, FACTORS_LEFT_OUT, "UCT worked it out at Mon, Jun 2, 8:40 PM ET (UCT's own time), and this answer never works it out again."])
    expect(a.facts).toMatchObject({ as_of: '2031-06-02', r2: 0.61, unstable: true, max_vif: { key: 'momentum', value: 6.4 } })
    expect(a.facts.loadings.find(r => r.key === 'quality')).toBeUndefined()           // a factor left out has no loading, never 0
  })
  it('a window not fitted states no loading and no reading, never 0', () => {
    const a = honest(answerFromFactors(factorsEnv({ now: { state: 'short', needed: 200, held: 120, unit: 'returns' }, reading: null }), 'QZSA'))
    expect(lines(a)).toContain('The newest window was not fitted, so no loading, R-squared or reading is stated: that is not a loading of 0.')
    expect(a.text).not.toMatch(/reading:/)
    expect(a.table).toBeUndefined()
  })
  it('not held, refused and an unclean answer are never "no exposure"', () => {
    expect(answerFromFactors(UNAVAILABLE, 'QZSA').text).toMatch(/^I couldn't read QZSA's factor exposure: it is not held on the server yet .* No loading is stated\. That is not the same as no exposure\.$/)
    expect(answerFromFactors(REFUSED, 'QZSA').text).toBe(`I couldn't read QZSA's factor exposure: ${REFUSED_WORDS}. No loading is stated. That is not the same as no exposure.`)
    expect(honest(answerFromFactors(factorsEnv({ now: null }), 'QZSA')).text).toMatch(/did not answer cleanly/)
  })
  it('every field the answer reads is the kind\'s own (read from the adapter), and the factors are the service\'s', () => {
    const src = adapter('factor_exposure_read')
    expect(pyKind(src)).toBe(KINDS.factors)
    for (const key of plain(factorsEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
    expect(pyTuple(src, 'FACTOR_KEYS')).toEqual(factorsData().factors.map(f => f.key))
  })
})

// ── stock.setupHistory → stock.setupHistory ────────────────────────────────────────────────────────────────────────────
const sig = (date, setup, phase, r5, r20, r60) => ({ date, setup, phase, returns: { 5: r5, 20: r20, 60: r60, isolated: true }, isolated: true })
const setupsData = (over = {}) => ({
  symbol: 'QZSA', session: '2031-06-02', data_through: '2031-06-02', first: '2027-01-04', sessions: 1110, read_at: READ_AT, source: 'invented', horizons: [5, 20, 60],
  phases: { state: 'ok', index: 'S&P 500', hindsight: 'invented hindsight' },
  total: 14, shown: 3, signals: [sig('2031-05-20', 'brk', 'uptrend', 2.1, null, null), sig('2031-02-03', 'pb', null, -1.2, 4.4, 9.8), sig('2030-09-09', 'brk', 'correction', 1.0, -3.0, 5.5)],
  per_setup: { brk: 9, pb: 5 },
  library: [{ id: 'brk', name: 'Invented breakout', words: 'invented' }, { id: 'pb', name: 'Invented pullback', words: 'invented' }],
  setups: [{ id: 'brk', state: 'ok', signals: 9 }, { id: 'pb', state: 'ok', signals: 5 }],
  universe: { state: 'ok', window: { from: '2023-06-02', to: '2031-06-02' }, built_at: '2031-05-31T02:00:00Z', min_signals: 30, note: 'invented',
    lines: { 'brk|uptrend': { signals: 900, horizons: { 20: { n: 880, below_floor: false, win_rate: 56.0, avg_pct: 1.9, median_pct: 1.1, excess_pct: 0.6 } } },
      'pb|all': { signals: 12, horizons: { 20: { n: 12, below_floor: true, win_rate: null, avg_pct: null, median_pct: null, excess_pct: null } } } } },
  one_signal_per_run: 'invented', fill: 'invented', stale_for: [], ...over,
})
const setupsEnv = (over = {}, envOver = {}) => envelope(KINDS.setups, setupsData(over), envOver)

describe('stock.setupHistory — the answer', () => {
  it('the newest signals of each setup with their phase and returns, and the universe line per setup and phase', () => {
    const a = honest(answerFromSetups(setupsEnv(), 'QZSA'))
    const l = lines(a)
    expect(l[0]).toMatch(/^QZSA had 14 signals of the 2 setups over its held history/)
    expect(l).toContain('• May 20, 2031: Invented breakout (Later in an uptrend): +2.1% / n/a / n/a')
    expect(l).toContain('• Feb 3, 2031: Invented pullback (No phase (outside the index history held)): -1.2% / +4.4% / +9.8%')
    expect(l).toContain('14 signals are held for QZSA and the newest of each setup are in this answer (3 in all): each setup\'s list is cut from the old end.')
    expect(l).toContain('• Invented breakout, later in an uptrend: up 56% of the time over 880 signals, average +1.9%')
    expect(l).toContain('• Invented pullback, all days: Too few signals: 12 (30 needed).')
    expect(l).toContain(SETUPS_HINDSIGHT)
    expect(l.slice(-2)).toEqual([SETUPS_RECORD, "UCT worked it out at Mon, Jun 2, 8:40 PM ET (UCT's own time), and this answer never works it out again."])
    expect(a.facts).toMatchObject({ as_of: '2031-06-02', total: 14, shown: 3, universe: 'ok', phases: 'ok' })
    expect(a.facts.signals[0].returns[20]).toBeNull()                          // a return the history cannot reach yet: null, never 0
  })
  it('a universe not held, no phases and no signal at all are each said', () => {
    const a = honest(answerFromSetups(setupsEnv({ universe: { state: 'not_held' }, phases: { state: 'not_held' } }), 'QZSA'))
    expect(lines(a)).toContain(`Universe lines: ${UNIVERSE_STATE_WORDS.not_held}`)
    expect(lines(a)).toContain('The S&P 500\'s declines were not held when UCT worked this out, so no signal carries a market phase.')
    const none = honest(answerFromSetups(setupsEnv({ total: 0, shown: 0, signals: [], per_setup: { brk: 0, pb: 0 } }), 'QZSA'))
    expect(lines(none)[0]).toMatch(/^QZSA had no signal of the 2 setups in the prices UCT holds/)
    expect(none.table).toBeUndefined()
  })
  it('not held, refused and an unclean answer are never "no signal"', () => {
    expect(answerFromSetups(UNAVAILABLE, 'QZSA').text).toMatch(/^I couldn't read QZSA's setup history: it is not held on the server yet .* No signal is stated\. That is not the same as no signal\.$/)
    expect(answerFromSetups(REFUSED, 'QZSA').text).toBe(`I couldn't read QZSA's setup history: ${REFUSED_WORDS}. No signal is stated. That is not the same as no signal.`)
    expect(honest(answerFromSetups(setupsEnv({ signals: null }), 'QZSA')).text).toMatch(/did not answer cleanly/)
  })
  it('the limits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('setup_history_read')
    expect(pyKind(src)).toBe(KINDS.setups)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([SETUPS_DEFAULT_ROWS, SETUPS_MAX_ROWS])
    for (const key of plain(setupsEnv().data)) expect(src.includes(`"${key}"`), key).toBe(true)
    expect(Object.keys(UNIVERSE_STATE_WORDS).sort()).toEqual(['computing', 'not_held', 'unavailable', 'waiting'])
  })
})

describe('the price studies — stale words', () => {
  it('an earlier session\'s answer and closes that stop short are said in each price study, with its own panel code, never worked out again', () => {
    const stale = { session: '2031-05-30', data_through: '2031-05-29', stale_for: ['earlier_session', 'closes_short'] }
    for (const [fn, env, code, it] of [[answerFromFootprint, footprintEnv, 'VFP', 'it'], [answerFromFactors, factorsEnv, 'FCTX', 'it'], [answerFromSetups, setupsEnv, 'SETH', 'it']]) {
      const a = honest(fn(env(stale, { stale: true }), 'QZSA'))
      expect(lines(a), code).toContain(`Stale: UCT worked ${it} out for the session of Fri, May 30, 2031, and a newer session has closed since. This answer never works ${it} out again: open ${code} for QZSA in UCT, then ask again.`)
      expect(lines(a), code).toContain('Stale: the newest close UCT held for QZSA (Thu, May 29, 2031) stops short of the session it was worked out for: the store had not caught up, or the stock did not trade.')
      expect(a.facts.stale_for, code).toEqual(['earlier_session', 'closes_short'])
      expect(fn(env(), 'QZSA').text, code).not.toMatch(/^Stale:/m)
    }
  })
})

// ── company.publicRecords → stock.companyRecord ────────────────────────────────────────────────────────────────────────
const CREDIT = { contracts: 'Recipient names come in part from D&B Open Data (Dun & Bradstreet).', trials: 'Data from ClinicalTrials.gov; the titles, statuses, phases, conditions, dates and enrollment are shown as registered, and no text is changed.',
  fda: 'Data provided by the U.S. Food and Drug Administration.', lobbying: 'Senate Office of Public Records cannot vouch for the data or analyses derived from these data after the data have been retrieved from LDA.gov.' }
const NAMES = [{ name: 'Kestrel Invented Corp', source: 'sec', source_words: 'its SEC name', until: null }]
const section = (k, state, extra = {}) => ({ source: `${k} source`, source_url: null, credit: CREDIT[k], state, read_at: READ_AT, searched_for: 'KESTREL INVENTED', names: NAMES,
  counted: state === 'matched' ? [{ name: 'KESTREL INVENTED CORP', how: 'same', how_words: 'the same name', against: 'Kestrel Invented Corp', amount: null, prior_amount: null, records: 1 }] : [],
  counted_total: state === 'matched' ? 1 : 0, not_counted_total: 0, dropped: 0, check: null, ...extra })
const recordsData = (over = {}) => ({
  symbol: 'QZSA', as_of: null, company: { state: 'ok', cik: '0009990001', names: NAMES, read_at: READ_AT, source: 'invented' },
  contracts: section('contracts', 'matched', { recent_total: 4200000.0, prior_total: 0.0, windows: { recent: ['2030-06-03', '2031-06-03'], prior: ['2029-06-03', '2030-06-02'] }, recipients_more: false, awards_more: false,
    awards: [{ award_id: 'INV1', recipient: 'KESTREL INVENTED CORP', date: '2031-04-14', amount: 1500000.0, agency: 'Department of Invented Affairs', sub_agency: null, description: 'Invented widgets', description_cut: false, place: null, kind: null, url: null }],
    awards_held: 7 }),
  trials: section('trials', 'no_match', { active_matched: 0, closed_matched: 0, active_total: 0, active_read: 0, by_phase: {}, by_status: {}, data_processed: '2031-06-02T10:00:05', closed_since: '2030-06-03', active: [], active_held: 0 }),
  fda: { source: 'fda source', source_url: null, credit: CREDIT.fda, state: 'not_held' },
  lobbying: section('lobbying', 'matched', { quarters: [{ year: 2031, quarter: 1, label: 'Q1 2031', ends: '2031-03-31', due: '2031-04-20', reports_due: false, filings: 2, own: 120000.0, own_reports: 1,
    own_no_figure: 0, firms: null, firm_reports: 1, firms_no_figure: 1, firm_names: ['INVENTED FIRM'], issues: [], issues_more: 0 }], cut: false, filings_read: 2 }),
  ...over,
})
const recordsEnv = (over = {}, envOver = {}) => envelope(KINDS.records, recordsData(over), { freshness: 'periodic', as_of: null, status: 'partial', ...envOver })

describe('stock.companyRecord — the answer', () => {
  it('each section with its state, headline figure, matched names and its agency\'s own required words; a section not held is said', () => {
    const a = honest(answerFromRecords(recordsEnv(), 'QZSA'))
    const l = lines(a)
    expect(l[0]).toBe("Kestrel Invented Corp's public records as UCT holds them (QZSA), section by section:")
    expect(l.find(x => x.startsWith(RECORD_TITLES.contracts))).toContain('against $0 in the 12 months before')
    expect(l).toContain('  Matched names: KESTREL INVENTED CORP.')
    expect(l).toContain('  7 matched and the first 1 are in this answer: the list is cut from the old end.')
    expect(l).toContain(`  ${CREDIT.contracts}`)
    expect(l.find(x => x.startsWith(RECORD_TITLES.trials))).toContain('No record matched, which is not the same as no record existing.')
    expect(l).toContain(`  ${CREDIT.trials} Data processed by ClinicalTrials.gov 2031-06-02 at 10:00:05.`)
    expect(l).toContain(`${RECORD_TITLES.fda}: ${RECORD_NOT_HELD}`)
    expect(l).toContain('  • Q1 2031: $120K in its own reports, no figure reported by outside firms')
    expect(l.find(x => x.startsWith(`  ${CREDIT.lobbying}`))).toContain("Accessed by UCT at Mon, Jun 2, 8:40 PM ET (UCT's own time).")
    expect(l[l.length - 1]).toBe(RECORDS_RECORD)
    expect(a.text).not.toMatch(/\bno records? exists?\b|\bnone exist\b/i)
    expect(a.facts).toMatchObject({ as_of: null, partial: true, states: { contracts: 'matched', trials: 'no_match', fda: 'not_held', lobbying: 'matched' } })
  })
  it('nothing held, refused and an unclean answer are never "no records"', () => {
    expect(answerFromRecords(UNAVAILABLE, 'QZSA').text).toBe("I couldn't read QZSA's public records: none are held on the server yet (this answer never asks an agency), or the read failed. Open PUBR for QZSA in UCT, then ask again. No record is stated. That is not the same as no records.")
    expect(answerFromRecords(REFUSED, 'QZSA').text).toBe(`I couldn't read QZSA's public records: ${REFUSED_WORDS}. No record is stated. That is not the same as no records.`)
    expect(honest(answerFromRecords(recordsEnv({ fda: null }), 'QZSA')).text).toMatch(/did not answer cleanly/)
  })
  it('the limits, the sections, the credits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('public_records_read')
    expect(pyKind(src)).toBe(KINDS.records)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([RECORDS_DEFAULT_ROWS, RECORDS_MAX_ROWS])
    expect(pyTuple(src, 'SECTIONS')).toEqual([...RECORD_SECTIONS])
    for (const [k, words] of Object.entries(CREDIT)) expect(src.includes(`"${k}": "${words}"`), k).toBe(true)
    for (const key of [...plain(recordsEnv().data), ...plain(recordsData().contracts)]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── ownership.funds → stock.ownershipReport ─────────────────────────────────────────────────────────────────────────────
const holder = (name, shares, value, state, prior, change, changePct) => ({ name, family: 'Invented Trust', shares, value, pct: 0.4, period: '2031-03-31', prior_shares: prior, prior_value: null,
  prior_period: prior == null ? null : '2030-12-31', change_shares: change, change_pct: changePct, state, url: null, isolated: true })
const fundsData = (over = {}) => ({
  symbol: 'QZSA', state: 'ok', source: 'SEC Form N-PORT (public; filed 60 days after each quarter-end month)',
  data_set: { quarter: '2031Q1', prior_quarter: '2030Q4', built_at: '2031-05-23T05:10:00+00:00', periods: { from: '2031-01-31', to: '2031-03-31' }, prior_missing: null, splits: { state: 'ok' } },
  coverage: { matched_value_pct: 91.4, matched_rows_pct: 80.0, pct_units: 'assumed_percent' },
  summary: { funds: 14, shares: 3200000, value: 131000000, value_complete: true, added: 6, cut: 3, unchanged: 2, new: 2, no_prior: 1, not_comparable: 0, sold_out: 1,
    both_now: 2900000, both_prior: 2500000, period_from: '2031-01-31', period_to: '2031-03-31', tier: 'fund_ticker', votes: 9 },
  holders: [holder('Invented Total Market Index Fund', 1000000, 41000000, 'added', 900000, 100000, 11.11), holder('Invented Growth Fund', 500000, null, 'new', null, null, null)],
  holders_total: 14, holders_limit: 50, sold_out: [{ name: 'Invented Income Fund', family: null, prior_shares: 700, prior_value: null, prior_period: '2030-12-31', period: '2031-03-31', url: null }],
  sold_out_total: 1, check: null, ...over,
})
const fundsEnv = (over = {}, envOver = {}) => envelope(KINDS.funds, fundsData(over), { freshness: 'periodic', as_of: '2031-03-31T04:00:00Z', ...envOver })

describe('stock.ownershipReport — the answer', () => {
  it('how many funds hold it and what changed, the largest holders with their change, the coverage and the data set', () => {
    const a = honest(answerFromFunds(fundsEnv(), 'QZSA'))
    const l = lines(a)
    expect(l[0]).toBe("The registered funds (mutual funds and ETFs) holding QZSA, from the SEC's Form N-PORT data sets as UCT holds them (the 2031 Q1 data set):")
    expect(l).toContain("Since each fund's previous report: 6 added, 3 cut, 2 unchanged, 2 new, 1 sold out. 1 fund has no earlier report in the data, so its change is not known.")
    expect(l.find(x => x.startsWith('The funds with both reports held'))).toContain('(+400K net)')
    expect(l).toContain('• Invented Total Market Index Fund: 1.0M shares ($41.0M), +100K since its previous report (period ending Mar 31, 2031)')
    expect(l.find(x => x.startsWith('• Invented Growth Fund'))).toContain('new since its previous report')
    expect(l).toContain('14 funds hold it and the top 2 by value are in this answer: the list is cut from the small end.')
    expect(l).toContain('Sold out since their previous report: Invented Income Fund.')
    expect(l[l.length - 1]).toBe(FUNDS_RECORD)
    expect(a.facts).toMatchObject({ state: 'ok', as_of: '2031-03-31', quarter: '2031Q1', funds: 14, added: 6, cut: 3, new: 2, sold_out: 1, shares_now: 2900000, shares_before: 2500000 })
  })
  it('a stock no fund holding could be matched to is never "no fund holds it"; a change not comparable is neither added nor cut', () => {
    const a = honest(answerFromFunds(fundsEnv({ state: 'not_matched', summary: null, holders: [], holders_total: 0, sold_out: [], sold_out_total: 0 }), 'QZSA'))
    expect(lines(a)).toContain('No fund holding in the newest N-PORT data set (2031 Q1) could be matched to QZSA. That is not the same as no fund holding it.')
    expect(a.table).toBeUndefined()
    const apart = honest(answerFromFunds(fundsEnv({ summary: { ...fundsData().summary, not_comparable: 2 } }), 'QZSA'))
    expect(apart.text).toContain('not counted as added or cut')
  })
  it('not read yet, refused and an unclean answer are never "no fund holds it"', () => {
    expect(answerFromFunds(UNAVAILABLE, 'QZSA').text).toBe("I couldn't read the funds holding QZSA: the SEC's Form N-PORT data sets have not been read on the server yet (this answer never downloads them), or the read failed. No fund is stated. That is not the same as no fund holding it.")
    expect(answerFromFunds(REFUSED, 'QZSA').text).toBe(`I couldn't read the funds holding QZSA: ${REFUSED_WORDS}. No fund is stated. That is not the same as no fund holding it.`)
    expect(honest(answerFromFunds(fundsEnv({ state: 'weird' }), 'QZSA')).text).toMatch(/did not answer cleanly/)
  })
  it('the limits, the states and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('fund_holders_read')
    expect(pyKind(src)).toBe(KINDS.funds)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([FUNDS_DEFAULT_ROWS, FUNDS_MAX_ROWS])
    expect(pyTuple(src, 'STATES')).toEqual(['ok', 'none_now', 'not_matched', 'not_built', 'unavailable'])
    for (const key of [...plain(fundsEnv().data), ...plain(fundsData().holders[0])]) expect(src.includes(`"${key}"`), key).toBe(true)
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
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest(); _resetTerminalWave7ForTest(); _resetTerminalWave8ForTest(); _resetTerminalWave9ForTest(); _resetTerminalWave10ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the six kinds and the six capabilities, by name', () => {
    expect(KINDS).toEqual({ stats: 'stock.stats', footprint: 'stock.volumeFootprint', factors: 'stock.factorExposure', setups: 'stock.setupHistory', records: 'company.publicRecords', funds: 'ownership.funds' })
    expect(CAPABILITIES).toEqual({ stats: 'stock.riskProfile', footprint: 'stock.volumeFootprint', factors: 'stock.factorExposure', setups: 'stock.setupHistory', records: 'stock.companyRecord', funds: 'stock.ownershipReport' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'bars.daily', 'stock.setups', 'seasonality.stock', 'fed.watch'], 'other kinds only']])('dark (%j, %s): none of the six is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave10Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave10Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all six served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
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
      expect(cap.hints, name).toMatch(/never today/)
      expect(cap.hints, name).toMatch(/reply: one short line, no figures\.$/)
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all six kinds of this wave are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments (rows clamped to the kind\'s own limits)', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.stats] = () => statsEnv()
    ENVS[KINDS.footprint] = () => footprintEnv()
    ENVS[KINDS.factors] = () => factorsEnv()
    ENVS[KINDS.setups] = () => setupsEnv()
    ENVS[KINDS.records] = () => recordsEnv()
    ENVS[KINDS.funds] = () => fundsEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.stats, { symbol: 'qzsa', rows: null })).text).toMatch(/^QZSA's statistics as UCT holds them/)
    expect((await run(CAPABILITIES.stats, { symbol: '$QZSA', rows: 999 })).text).toMatch(/^QZSA's statistics/)
    expect((await run(CAPABILITIES.footprint, { symbol: 'QZSA', rows: 0 })).text).toMatch(/^QZSA's volume footprint/)
    expect((await run(CAPABILITIES.factors, { symbol: 'QZSA' })).text).toMatch(/^How QZSA traded/)
    expect((await run(CAPABILITIES.setups, { symbol: 'QZSA', rows: 99 })).text).toMatch(/^QZSA had 14 signals/)
    expect((await run(CAPABILITIES.records, { symbol: 'brk.b', rows: null })).text).toMatch(/public records as UCT holds them \(BRK-B\)/)
    expect((await run(CAPABILITIES.funds, { symbol: 'QZSA', rows: 51 })).text).toMatch(/^The registered funds/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.stats, { symbol: 'QZSA', rows: 5 }, 'answer'],
      [KINDS.stats, { symbol: 'QZSA', rows: 40 }, 'answer'],
      [KINDS.footprint, { symbol: 'QZSA', rows: 1 }, 'answer'],
      [KINDS.factors, { symbol: 'QZSA' }, 'answer'],
      [KINDS.setups, { symbol: 'QZSA', rows: 20 }, 'answer'],
      [KINDS.records, { symbol: 'BRK-B', rows: 5 }, 'answer'],
      [KINDS.funds, { symbol: 'QZSA', rows: 50 }, 'answer'],
    ])
  })

  it('no read without a ticker or a turn, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const name of ALL) expect((await inTurn(() => getCapability(name).answer(null, { symbol: '', rows: null }, null))).text, name).toMatch(/^Which stock's .* should I read\? Give me one ticker\./)
    for (const name of ALL) expect((await getCapability(name).answer(null, { symbol: 'QZSA', rows: null }, null)).text, name).toMatch(/needs the Agent's turn/)
    expect(reads()).toEqual([])
    for (const name of ALL) {                                           // the stub refuses every kind
      const a = await inTurn(() => getCapability(name).answer(null, { symbol: 'QZSA', rows: null }, null))
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
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE10_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  stats: ['NVDA stock stats', 'stock statistics for AMD', "what is NVDA's beta", 'beta of AMD vs SPY', 'how volatile is TSLA', 'realized volatility of NVDA',
    'how did NVDA hold up in corrections', 'NVDA 5 year return', 'correlation with SPY for AMD', 'up capture for MSFT'],
  footprint: ['NVDA volume footprint', 'accumulation days in AMD', 'distribution days on TSLA', 'accumulation distribution for NVDA', 'pocket pivots on NVDA',
    'up down volume for AMD', 'unfilled gaps on TSLA', 'NVDA gap fill rate'],
  factors: ['NVDA factor exposure', 'factor loadings for AMD', 'is TSLA a growth or value stock', 'style tilt of NVDA', 'exposure to the momentum factor for AMD',
    'does NVDA trade like a small cap stock'],
  setups: ['NVDA setup history', 'history of setups on AMD', 'setups that fired on TSLA', 'past signals on NVDA', "how have NVDA's setups done", 'how did setups do on AMD'],
  records: ['NVDA government contracts', 'LMT federal contracts', 'clinical trials for LLY', 'FDA approvals for MRNA', 'lobbying by AMZN', 'public records for PFE', 'contract awards to RTX'],
  funds: ['which funds hold NVDA', 'mutual funds holding AMD', 'ETFs that own TSLA', 'NVDA fund holders', 'N-PORT holders of AAPL', 'funds that added NVDA'],
}
/** another capability's language: none of the six's words may name these */
const NOT_OURS = [
  'NVDA implied volatility', 'NVDA IV history', 'IV rank for NVDA', 'realized vs implied volatility for NVDA',                       // wave 7's IV history
  'confirmed setups on NVDA', 'any setups on NVDA', 'which setups did the judge confirm for TSLA', 'walk me through the setup on NVDA',  // wave 7, the chart in view
  'what is the win rate of the HTF setup', 'what are the rules of the breakout setup',                                                 // the playbook
  'NVDA drawdowns', 'how far is NVDA off its high', 'what happens after NVDA gaps up 5%', 'how has NVDA done after gapping up',     // the data group's history
  'stocks with pocket pivots today', 'scan for pocket pivots', 'stocks with the most accumulation days', 'find stocks with high beta', // the screener
  'what is a pocket pivot', 'explain beta', 'what is factor exposure', 'what are clinical trials', 'define accumulation days',       // what a term means
  'distribution days on the nasdaq', 'how many distribution days does the market have', 'accumulation days on the S&P',             // the market's
  'add ATR to the chart', 'add the volume profile', 'change the chart style', 'factor in the earnings date',                        // the chart
  'options contracts for NVDA', 'most active contracts on SPY', 'NVDA call open interest', 'start a free trial', 'the trial period',  // options, the app
  'FDA news for LLY', 'PDUFA date for MRNA', 'FDA calendar this week', 'NVDA news', 'what is moving NVDA',                          // news, catalysts
  'hedge funds holding NVDA', 'institutional ownership of NVDA', 'what does SPY hold', 'ARKK holdings', 'fund flows into SPY', 'my funds', // 13F, a fund's own, flows
  'insider buying in NVDA', 'short interest on NVDA', 'NVDA seasonality', 'NVDA earnings', 'NVDA dividend yield',
  'my trading stats', 'breadth stats', 'flow record stats', 'open the stats page', 'the journal beta tab', 'beta features',
  'stats', 'beta', 'volume', 'gaps', 'factor', 'setup', 'setups', 'funds', 'records', 'contracts', 'trials', 'lobby', 'statistics',
  'alert me when NVDA gaps up', 'notify me of FDA approvals', 'add NVDA to my watchlist', 'go to the public records panel',
  'STAT NVDA', 'open STAT for NVDA', 'VFP AMD', 'FCTX TSLA', 'SETH NVDA', 'PUBR LLY', 'OWN NVDA', 'go to the FCTX panel',         // the Terminal codes
  'NVDA fundamentals', 'NVDA profile', 'how much is NVDA', 'NVDA quote', 'compare NVDA vs AMD', 'NVDA market cap',             // fundamentals, the quote
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'recent IPOs', 'which themes are rotating in',
  'what is on the confluence board', 'expected move for NVDA earnings', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings reactions for yesterday', 'earnings season today',
  'call themes this month', 'short interest on NVDA', 'NVDA days to cover', 'NVDA seasonality', 'market tide history', 'open interest change on NVDA', 'treasury yields', 'the 10-year yield',
  'what is the market regime', 'confirmed setups on NVDA', 'NVDA events timeline', 'the UCT 20', 'NVDA IV history', 'NVDA dilution', 'NVDA corporate actions', 'IPO calendar',
  'upcoming IPOs', 'next ex-dividend date for KO', 'split history for AAPL', 'treasury auctions', 'real yields', 'fed watch', 'what changed in the FOMC statement']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the six by action with no word of its own, and it is the 52nd of the 56 the server keeps', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups (56 since the integrator's wave 7 build); this wave's is the 52nd, and the cap is
    // not changed here. A later wave's group comes after it.
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([52, 56, true])
    expect(GROUPS.map(x => x.id).slice(45, 52)).toEqual([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, WAVE9_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
    expect([WAVE7_GROUP, WAVE9_GROUP].map(id => GROUPS.find(x => x.id === id).actions.length)).toEqual([6, 3])
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'bars.daily', 'stock.setups', 'options.ivHistory'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data group keeps exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE10_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, WAVE9_GROUP, 'cot'].map(groupWords)).toEqual([[], [], [], [], [], [], []])
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave10Capabilities()                               // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE10_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE10_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
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

  it('the nearest neighbours keep their own asks: implied volatility, the confirmed setups, a stock\'s drawdowns and event study, the news; a shared ask offers both', async () => {
    wire([...PAIRS.map(p => p[0]), 'options.ivHistory', 'stock.setups', 'quotes', 'quote', 'earnings', 'bars.daily', 'history.eventStudy', 'news.company', 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(['stock.ivHistory', 'stock.setups']))   // non-vacuity: the neighbours are registered
    const routed = (q) => [routeManifest, routeManifestV2].map(route => [route.name, route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)])
    for (const [q, cap, group] of [['NVDA IV history', 'stock.ivHistory', WAVE7_GROUP], ['confirmed setups on NVDA', 'stock.setups', WAVE7_GROUP]]) {
      expect(selectGroups(q).selected, q).toContain(group)
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain(cap)
    }
    for (const q of ['NVDA drawdowns', 'what happens after NVDA gaps up 5%', 'NVDA news']) {
      expect(selectGroups(q).selected, q).toContain('data')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // this wave's asks route its capabilities
    for (const [q, key] of [['NVDA stock stats', 'stats'], ['pocket pivots on NVDA', 'footprint'], ['NVDA factor exposure', 'factors'], ['NVDA setup history', 'setups'],
      ['clinical trials for LLY', 'records'], ['which funds hold NVDA', 'funds']]) {
      expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain(CAPABILITIES[key])
    }
    // a bare word selects nothing of this wave under v1
    for (const q of ['stats', 'beta', 'volume', 'gaps', 'factor', 'setups', 'funds', 'records', 'contracts', 'trials', 'lobby']) {
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm', 'stats', 'beta', 'funds']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the typo lexicon: registering the six changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A name's, a summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'make it shorter', 'sorted results', 'hover over it', 'recover the layout', 'floating window', 'rank them', 'interesting names today', 'whats the reprot date',
      'the newst one', 'offen', 'the sme one', 'frist one', 'munth view', 'each one', 'ago', 'weak names', 'the bord', 'actions', 'caution', 'records', 'recrod', 'stats', 'state',
      'expose', 'risk', 'profle', 'holdings', 'fund', 'fnds', 'owner', 'ownershp', 'reprot', 'histroy', 'setpu', 'compnay', 'reocrd', 'volme']
    // words one edit from the three new words: the only corrections that move, each pinned. None is in a corpus phrasing; a
    // word UCT does not know ("factory", "actor") was left alone before and now reads as "factor", which fastPath uses only when
    // the corrected sentence parses into a safe, reversible action
    const NEAR = { factors: ['[]', '["factor"]'], fator: ['[]', '["factor"]'], actor: ['[]', '["factor"]'], factory: ['[]', '["factor"]'],
      exposures: ['[]', '["exposure"]'], exposre: ['[]', '["exposure"]'], footprints: ['[]', '["footprint"]'], footprnt: ['[]', '["footprint"]'] }
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
    // the six add exactly three words to the lexicon, all from their names: every other word of a summary and a hint is either
    // already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(['exposure', 'factor', 'footprint'])
  })

  it('no OTHER capability\'s capreg corpus phrasing is named by these words (armed, the group rides with none of them)', () => {
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
      namedBy(WAVE7_ROUTE_WORDS), namedBy(WAVE8_ROUTE_WORDS), namedBy(WAVE9_ROUTE_WORDS)]
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(earlier.flatMap(f => f(q)), q).toEqual([])
    const mine = allPhrasings().filter(p => ALL.includes(p.intent.id)).map(p => p.ph.text)
    expect(mine).toHaveLength(24)
    for (const q of mine) expect(earlier.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(earlier.flatMap(f => f(q)).length, q).toBeGreaterThan(0)    // non-vacuity: an earlier wave really names it
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no row of the routing-collision table is named by these words (every row belongs to another group)', () => {
    expect(collisions.rows.length).toBeGreaterThan(10)
    const stolen = collisions.rows.filter(r => r.owner !== ROUTE_GROUP && !(r.also || []).includes(ROUTE_GROUP) && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
