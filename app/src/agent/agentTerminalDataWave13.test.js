// Terminal data wave 13 — six LOCAL-ONLY capabilities over six model-isolated kinds (MD-1 §4.22):
//   stock.insiderBuying ← insider.market · stock.marketHistory ← market.history · stock.economyBoard ← econ.latest ·
//   stock.liquidityBoard ← market.liquidity · stock.oilReport ← market.oil · stock.daysLikeToday ← market.analogs.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date, never calls a missing number 0, says when a list is cut and from which end, never calls "not held" or a
// failed read "none", never names a vendor, never echoes an envelope note, and is a record, never a forecast. The economy,
// liquidity and oil answers are the panels' own models over the held rows. Routing: the six share ONE words-only group of
// their own (`marketMacro`, the 55th of the 56 the server keeps). Each capability's own words are armed only while it is
// registered, and they never name another capability's language: one stock's insiders, insider buying by sector, one
// stock's corrections, the Fed watch, Treasury yields, the price of oil, crude positioning, oil stocks, a setup's analogs,
// sentiment, alerts, navigation and what a term means. The Terminal codes' keywords are checked both ways.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import './terminalWaves'                       // the Terminal waves register through registerServerGatedBuiltins() (PR #2677)
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
import { FUNCTIONS } from '../pages/terminal/functions'
import { ECON_SYMBOLS } from '../pages/terminal/panels/economyModel'
import { LIQ_SYMBOLS } from '../pages/terminal/panels/liquidityModel'
import { OIL_SYMBOLS } from '../pages/terminal/panels/oilModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetCotForTest, COT_ROUTE_WORDS } from './capabilities/cot'
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
import { _resetTerminalWave10ForTest, WAVE10_ROUTE_WORDS, ROUTE_GROUP as WAVE10_GROUP } from './capabilities/terminalDataWave10'
import { _resetTerminalWave11ForTest, WAVE11_ROUTE_WORDS, ROUTE_GROUP as WAVE11_GROUP } from './capabilities/terminalDataWave11'
import { _resetTerminalWave12ForTest, WAVE12_ROUTE_WORDS, ROUTE_GROUP as WAVE12_GROUP } from './capabilities/terminalDataWave12'
import {
  KINDS, CAPABILITIES, INSIDER_DEFAULT_ROWS, INSIDER_MAX_ROWS, INSIDER_RECORD, INSIDER_LEFT_OUT, HISTORY_DEFAULT_ROWS, HISTORY_MAX_ROWS, HISTORY_RECORD,
  ECON_RECORD, LIQ_RECORD, OIL_RECORD, ANALOGS_DEFAULT_ROWS, ANALOGS_MAX_ROWS, ANALOGS_RECORD,
  answerFromInsider, answerFromHistory, answerFromEconomy, answerFromLiquidity, answerFromOil, answerFromAnalogs,
  registerTerminalWave13Capabilities, _resetTerminalWave13ForTest, WAVE13_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave13'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyKind = (src, name = 'KIND') => new RegExp(`^${name} = "([\\w.]+)"`, 'm').exec(src)[1]
const pyTuple = (src, name) => [...new RegExp(`^${name} = \\(([\\s\\S]*?)\\)$`, 'm').exec(src)[1].matchAll(/"([A-Z0-9]+)"/g)].map(m => m[1])
const FETCHED = '2031-06-04T15:30:00Z'               // 11:30 AM ET, a Wednesday: the day of the read
const READ_AT = '2031-06-03T00:40:00Z'               // 8:40 PM ET the evening before
const NOTE = 'a provider note that must never be echoed 987654'
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2031-06-02T20:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
/** the data's vendors: an answer never names them */
const VENDORS = /\b(?:massive|polygon|finnhub|fmp|financial modeling prep|yahoo|yfinance|finviz|openinsider)\b/i
const FORECAST = /\b(?:will (?:rise|fall|go|be)|expect(?:s|ed)? (?:the market|stocks|prices) to|forecast(?:s|ed)? (?:a|the) )/i
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(VENDORS)
  expect(a.text).not.toMatch(FORECAST)
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Jun 4, 2031|2031-06-04/i)
  return a
}

// ── insider.market → stock.insiderBuying ───────────────────────────────────────────────────────────────────────────────
const buy = (symbol, shares, price, amount) => ({ symbol, name: `Made-up ${symbol} Insider`, title: 'director', shares, price, amount, date: '2031-05-29', filing_date: '2031-06-01' })
const insiderData = (over = {}) => ({
  purchases: { state: 'held', window_days: 7, cap: 50, total: 9, unpriced: 1, newest_filing: '2031-06-01',
    rows: [buy('QZCC', 5000, 3, 15000), buy('QZAA', 1000, 12.5, 12500), buy('QZBB', 400, null, null)] },
  clusters: { state: 'held', as_of: '2031-05-30', read_at: READ_AT, total: 3, truncated: true, min_insiders: 3, window_business_days: 10, left_out: ['people'],
    coverage: { complete: true, from: '2031-05-15', to: '2031-05-30', listed: 900, read: 900 },
    rows: [{ ticker: 'QZRB', company: 'Made-up Robotics Inc', insiders: 3, roles: { ceo: 1, director: 2 }, first_buy: '2031-05-26', last_buy: '2031-05-29', buys: 3,
      filings: 3, shares: 6000, value: 54000, value_complete: false, unpriced_buys: 1, avg_price: 13, close: { value: 14, date: '2031-05-30', reason: null }, change_pct: 7.7 }] },
  ...over })
describe('stock.insiderBuying — the answer', () => {
  it('both parts with their own dates, no price is no amount (never $0), each list cut from its own end', () => {
    const a = honest(answerFromInsider(envelope(KINDS.insider, insiderData(), { as_of: null })))
    expect(a.text).toContain('The latest open-market purchases from Form 4 filings over the last 7 days, largest dollar amount first:')
    expect(a.text).toContain('• QZAA: Made-up QZAA Insider (director) bought 1,000 shares at $12.50, $12,500.00, on May 29, 2031')
    expect(a.text).toContain('• QZBB: Made-up QZBB Insider (director) bought 400 shares, no price stated (so no amount), on May 29, 2031')
    expect(a.text).toContain('9 purchases are held and the first 3 are in this answer: the smallest are cut.')
    expect(a.text).toContain('1 purchase states no price, so it has no dollar amount (never $0).')
    expect(a.text).toContain('• QZRB (Made-up Robotics Inc): 3 insiders, May 26, 2031 to May 29, 2031, $54,000.00 (the priced buys only; 1 buy states no price)')
    expect(a.text).toContain('3 clusters are held and the newest 1 are in this answer: the list is cut from the old end.')
    expect(a.text).toContain("the purchases' newest filing is from Jun 1, 2031; the clusters cover the filing days read through May 30, 2031")
    expect(a.text).toContain(INSIDER_RECORD)
    expect(a.text).toContain(INSIDER_LEFT_OUT)
    expect(a.facts).toEqual({ purchases: 3, clusters: 1, newest_filing: '2031-06-01', clusters_as_of: '2031-05-30' })
    expect(a.table.rows.find(r => r.symbol === 'QZBB').value).toBe('no price')
  })
  it('a part not held, an empty list, no cluster, an incomplete read, refused and unclean are each said, never "no buying"', () => {
    const part = honest(answerFromInsider(envelope(KINDS.insider, insiderData({ purchases: { state: 'held', rows: [], total: 0, unpriced: 0, newest_filing: null }, clusters: { state: 'not_held' } }), { as_of: null })))
    expect(part.text).toContain('The held list of purchases is empty')
    expect(part.text).toContain('That is not the same as no insider buying.')
    expect(part.text).toContain('The insider clusters are not held on the server yet (this answer never reads the filings): open INS CLUSTER in UCT, then ask again.')
    expect(part.facts.clusters).toBeNull()
    const none = honest(answerFromInsider(envelope(KINDS.insider, insiderData({ clusters: { ...insiderData().clusters, rows: [], total: 0, coverage: { complete: false, from: '2031-05-15', to: '2031-05-30' } } }), { as_of: null })))
    expect(none.text).toContain('No stock in what UCT holds has an insider cluster (3 or more different insiders buying on the open market within 10 business days')
    expect(none.text).toContain('is not complete, so a cluster may be missing.')
    expect(answerFromInsider(UNAVAILABLE).text).toMatch(/^I couldn't read the market's insider buying: it is not held on the server yet .*That is not the same as no insider buying\.$/)
    expect(answerFromInsider(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromInsider(envelope(KINDS.insider, insiderData({ clusters: null }))).text).toMatch(/did not answer cleanly/)
  })
})

// ── market.history → stock.marketHistory ───────────────────────────────────────────────────────────────────────────────
const leaders = (state = 'ok') => ({ state, trough: '2031-02-14', end: '2031-05-16', index_return_pct: 12, priced_both: 400, sessions_so_far: 20, needed: 63,
  top: [{ sym: 'QZL1', sector: 'Made-up Sector', return_pct: 80.5, vs_index_pct: 68.5, check: false }, { sym: 'QZL2', sector: null, return_pct: 61.2, vs_index_pct: 49.2, check: true }],
  top_total: 25, sectors: [{ sector: 'Made-up Sector', median_pct: 20.1, count: 60 }], sectors_total: 9 })
const historyData = (over = {}) => ({ index: 'SPX', name: 'S&P 500', first: '1990-01-02', last: '2031-06-02', closes: 10000, definition: 'made-up words', leaders_state: 'ok',
  survivorship: 'From stocks that trade today: a made-up survivorship sentence.', built_for: '2031-06-02', built_at: READ_AT, stale_for: [], episodes_total: 30,
  summary: { since: '1990-01-02', corrections: 24, bear_markets: 6, ongoing: 1, recovered: 29, median_depth_pct: -14.5, median_recovery_sessions: 80 },
  episodes: [
    { kind: 'bear', peak: { date: '2031-03-03', close: 6100 }, trough: { date: '2031-05-01', close: 4700 }, depth_pct: -22.95, sessions_down: 42, recovered: null, sessions_to_recover: null,
      ongoing: true, peak_at_history_start: false, below_peak_now_pct: -18.0, rally: [{ months: 1, date: '2031-06-02', return_pct: 4.5 }, { months: 3, date: null, return_pct: null }], leaders: leaders('not_yet') },
    { kind: 'correction', peak: { date: '2030-11-04', close: 5900 }, trough: { date: '2031-02-14', close: 5200 }, depth_pct: -11.86, sessions_down: 70, recovered: '2031-02-28', sessions_to_recover: 10,
      ongoing: false, peak_at_history_start: false, below_peak_now_pct: null, rally: [{ months: 1, date: '2031-03-14', return_pct: 8.1 }], leaders: leaders() },
  ], ...over })
describe('stock.marketHistory — the answer', () => {
  it('the summary, each decline newest first with its depth, length, recovery, rally and leaders, the survivorship note; a month not reached is never 0', () => {
    const a = honest(answerFromHistory(envelope(KINDS.history, historyData(), { as_of: '2031-06-02T20:00:00Z', freshness: 'historical' })))
    expect(a.text).toContain("S&P 500's corrections (a fall of 10% to 20% on closing prices) and bear markets (20% or more) as UCT holds them, from its closes since Jan 2, 1990: 24 corrections and 6 bear markets, 1 not recovered yet; median depth -14.5%, median recovery 80 sessions.")
    expect(a.text).toContain('• Bear market from the peak of Mar 3, 2031 (6,100.00) to the low of May 1, 2031 (4,700.00): -22.9% in 42 sessions; not recovered yet, the newest close -18.0% below the peak. After the low: 1 month +4.5%, 3 months not reached yet.')
    expect(a.text).toContain('its leaders are not drawn yet: 20 of the 63 sessions after the low have closed.')
    expect(a.text).toContain('• Correction from the peak of Nov 4, 2030 (5,900.00) to the low of Feb 14, 2031 (5,200.00): -11.9% in 70 sessions; the peak was regained on Feb 28, 2031, 10 sessions after the low.')
    expect(a.text).toContain('Leaders in the 63 sessions after the low (the index +12.0%): QZL1 +80.5%, QZL2 +61.2% (a price jump to check) (the first 2 of 25); sector medians: Made-up Sector +20.1% (60 stocks).')
    expect(a.text).toContain('30 declines are held and the newest 2 are in this answer: the list is cut from the old end.')
    expect(a.text).toContain('From stocks that trade today: a made-up survivorship sentence.')
    expect(a.text).toContain("S&P 500's closes end with the session of Mon, Jun 2, 2031")
    expect(a.text).toContain(HISTORY_RECORD)
    expect(a.facts).toMatchObject({ index: 'SPX', as_of: '2031-06-02', episodes: 2, corrections: 24, bear_markets: 6, stale: false })
    const stale = honest(answerFromHistory(envelope(KINDS.history, historyData({ leaders_state: 'computing' }), { stale: true })))
    expect(stale.text).toContain('Stale: the held answer was built before')
    expect(stale.text).toContain('The leaders are still being worked out on the server')
  })
  it('not held, refused and an unclean answer are never "no declines"', () => {
    expect(answerFromHistory(UNAVAILABLE).text).toMatch(/That is not the same as no declines\.$/)
    expect(answerFromHistory(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromHistory(envelope(KINDS.history, historyData({ episodes: null }))).text).toMatch(/did not answer cleanly/)
  })
})

// ── the econ store's rows (econ.latest, market.liquidity, market.oil): the routes' own shape, made-up figures ─────────────
const T0 = 1937000000                                 // a made-up first-release time (2031)
/** the econ models' short date leaves the year out in the year of the run, so an expected 2031 date says so (never assumes 2031 is not the year) */
const Y31 = new Date().getUTCFullYear() === 2031 ? '' : ', 2031'
const ecMeta = (symbol, frequency, display, fmt, scale, op = null) => ({ symbol, name: `Made-up ${symbol}`, short_name: symbol, frequency,
  units: { display, fmt, scale }, source: { line: 'Source: a made-up agency' }, derivation: op ? { op, inputs: [] } : null })
const next = (date) => ({ state: 'current', latest_period: null, expected_period: null, next_release: { date, time: '08:30', tz: 'America/New_York', precision: 'exact' } })
const ecRow = (symbol, meta, points, over = {}) => ({ symbol, state: 'ok', meta, points, currentness: next('2031-07-15'), retrieved_at: null, read_at: READ_AT, ...over })
const monthly = (vals, year = 2031, first = 3) => vals.map((v, i) => { const m = String(first + i).padStart(2, '0'); return [T0 - (vals.length - 1 - i) * 2592000, v, `${year}-${m}-01`, `${year}-${m}-28`, 0] })
const weekly = (vals, end = '2031-05-28') => vals.map((v, i) => { const d = new Date(Date.parse(`${end}T00:00:00Z`) - (vals.length - 1 - i) * 7 * 86400000).toISOString().slice(0, 10); return [T0 - (vals.length - 1 - i) * 604800, v, d, d, 0] })
function econData() {
  const series = ECON_SYMBOLS.map(s => ecRow(s, ecMeta(s, 'M', '%', 'pct1', 1, s.endsWith('MOM') ? 'mom_pct' : s.endsWith('YOY') ? 'yoy_pct' : null), monthly([2.9, 3.1, 3.2])))
  const at = (s) => series.findIndex(r => r.symbol === s)
  series[at('USNFPCHG')] = ecRow('USNFPCHG', ecMeta('USNFPCHG', 'M', 'persons', 'k_persons', 1000, 'diff'), monthly([150, 210, 180]))
  series[at('USJOLTSO')] = { symbol: 'USJOLTSO', state: 'no_data', meta: ecMeta('USJOLTSO', 'M', 'count', 'k', 1000), points: [], currentness: null, retrieved_at: null, read_at: READ_AT }
  series[at('USPPIYOY')] = { symbol: 'USPPIYOY', state: 'not_held', meta: ecMeta('USPPIYOY', 'M', '%', 'pct1', 1, 'yoy_pct'), points: [], currentness: null, retrieved_at: null, read_at: null }
  return { columns: ['t', 'v', 'ps', 'pe', 'pit'], points_per_series: 3, series, attributions: {}, not_held: ['USPPIYOY'] }
}
describe('stock.economyBoard — the answer', () => {
  it('every theme by the panel\'s own model: the latest reading, the one before, the change, the release and the next release; what is not held is said', () => {
    const a = honest(answerFromEconomy(envelope(KINDS.economy, econData(), { status: 'partial', as_of: '2031-05-20T12:30:00Z' })))
    expect(a.text).toContain('The economy board as UCT holds it (official U.S. releases), theme by theme:')
    expect(a.text).toContain(`• Inflation: CPI 3.2% for May 2031, m/m 3.2%, released May 19${Y31}, prior 3.1% (+0.1 pts); next Jul 15${Y31}, 8:30 AM ET; `)
    expect(a.text).toContain(`Nonfarm payrolls 180.0K for May 2031, released May 19${Y31}, prior 210.0K (-30.0K); next Jul 15${Y31}, 8:30 AM ET`)
    expect(a.text).toContain('PPI: not held in the server\'s economics cache yet')
    expect(a.text).toContain('Job openings: no reading published here yet')
    expect(a.text).toContain('1 series is not held in the server\'s economics cache yet; this answer never loads it. That is not the same as no figure.')
    expect(a.text).toContain('Not on this board: Retail sales.')
    expect(a.text).toContain(ECON_RECORD)
    expect(a.facts).toMatchObject({ as_of: '2031-05-20T12:30:00Z', not_held: ['USPPIYOY'] })
    expect(a.table.rows.find(r => r.series === 'PPI').latest).toBe('not held')
  })
  it('not held, refused and an unclean answer are never "no figure"', () => {
    expect(answerFromEconomy(UNAVAILABLE).text).toMatch(/^I couldn't read the economy board: it is not held in the server's economics cache yet .*That is not the same as no figure\.$/)
    expect(answerFromEconomy(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromEconomy(envelope(KINDS.economy, { series: null })).text).toMatch(/did not answer cleanly/)
  })
})

function liqData({ rrp = true } = {}) {
  const usd = (s, f, scale) => ecMeta(s, f, 'USD', 'usd_compact', scale)
  const fed = weekly(Array.from({ length: 60 }, (_, i) => 7000000 + 1000 * i))        // millions: about $7.0T
  const tga = weekly(Array.from({ length: 60 }, () => 800000))                         // millions: $800B
  const rrpPts = weekly(Array.from({ length: 60 }, () => 200000000000))                // dollars: $200B
  const series = LIQ_SYMBOLS.map(s => ecRow(s, ecMeta(s, 'M', '%', 'pct1', 1), monthly([4.0, 4.1, 4.2])))
  const put = (r) => { series[series.findIndex(x => x.symbol === r.symbol)] = r }
  put(ecRow('USFEDBAL', usd('USFEDBAL', 'W', 1000000), fed.slice(-3)))
  put(ecRow('USTGAFED', usd('USTGAFED', 'W', 1000000), tga.slice(-3)))
  put(rrp ? ecRow('USRRP', usd('USRRP', 'D', 1), rrpPts.slice(-3)) : { symbol: 'USRRP', state: 'not_held', meta: usd('USRRP', 'D', 1), points: [], currentness: null, retrieved_at: null, read_at: null })
  const hist = (s, pts) => ({ symbol: s, columns: ['t', 'v', 'ps', 'pe', 'pit'], points: pts })
  return { latest: { columns: ['t', 'v', 'ps', 'pe', 'pit'], points_per_series: 3, series, attributions: {}, not_held: rrp ? [] : ['USRRP'] },
    histories: { USFEDBAL: hist('USFEDBAL', fed), USTGAFED: hist('USTGAFED', tga), USRRP: rrp ? hist('USRRP', rrpPts) : null, USTGA: null, USSOFR: null },
    history_days: { USFEDBAL: 790, USTGAFED: 790, USRRP: 790, USTGA: 70, USSOFR: 70 } }
}
describe('stock.liquidityBoard — the answer', () => {
  it('net liquidity by the panel\'s own calculation with its changes, then each part; an input not held means no value, never 0', () => {
    const a = honest(answerFromLiquidity(envelope(KINDS.liquidity, liqData(), { as_of: '2031-05-29T20:30:00Z' })))
    expect(a.text.split('\n')[0]).toBe('Net liquidity on Wed, May 28, 2031: $6.06T; the change over 1 week +$1.00B, 4 weeks +$4.00B, 13 weeks +$13.00B, 52 weeks +$52.00B.')
    expect(a.text).toContain(`Net liquidity rose $4.00B over 4 weeks (Apr 30${Y31} to May 28${Y31}): the Fed's assets rose $4.00B, the TGA was unchanged and reverse repo was unchanged.`)
    expect(a.text).toContain(`• Treasury General Account (H.4.1, Wednesday): $800.00B (Wed May 28${Y31}), unchanged over 1 week`)
    expect(a.text).toContain('The parts:')
    expect(a.text).toContain('• Fed total assets:')
    expect(a.text).toContain(LIQ_RECORD)
    expect(a.facts.net_date).toBe('2031-05-28')
    const gap = honest(answerFromLiquidity(envelope(KINDS.liquidity, liqData({ rrp: false }), { status: 'partial' })))
    expect(gap.text).toMatch(/^Net liquidity cannot be worked out: [a-z][^:]* is not held in the server's economics cache\. That is not the same as no figure\./)
    expect(gap.text).toContain('• Overnight reverse repo (ON RRP): not held in the server\'s economics cache yet')
    expect(gap.facts.net).toBeNull()
  })
  it('not held, refused and an unclean answer are each said', () => {
    expect(answerFromLiquidity(UNAVAILABLE).text).toMatch(/That is not the same as no figure published\.$/)
    expect(answerFromLiquidity(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromLiquidity(envelope(KINDS.liquidity, { latest: null })).text).toMatch(/did not answer cleanly/)
  })
})

function oilData() {
  const bbl = (s, f = 'W') => ecMeta(s, f, 'bbl', 'mbbl', 1000)
  const crude = weekly(Array.from({ length: 60 }, (_, i) => 430000 - 100 * i))
  const series = OIL_SYMBOLS.map(s => ecRow(s, bbl(s), weekly([1000, 1100, 1200])))
  const put = (r) => { series[series.findIndex(x => x.symbol === r.symbol)] = r }
  put(ecRow('USCRUDEINV', bbl('USCRUDEINV'), crude.slice(-3)))
  put(ecRow('USCRUDEINVCHG', ecMeta('USCRUDEINVCHG', 'W', 'bbl', 'mbbl', 1000, 'diff'), weekly([-1500, 900, -2300])))
  put(ecRow('USGASPRICE', ecMeta('USGASPRICE', 'W', 'USD/gal', 'usd3', 1), weekly([3.1, 3.12, 3.15])))
  return { latest: { columns: ['t', 'v', 'ps', 'pe', 'pit'], points_per_series: 3, series, attributions: {}, not_held: [] },
    histories: Object.fromEntries(OIL_SYMBOLS.map(s => [s, s === 'USCRUDEINV' ? { symbol: s, columns: ['t', 'v', 'ps', 'pe', 'pit'], points: crude } : null])),
    history_days: Object.fromEntries(OIL_SYMBOLS.map(s => [s, s === 'USCRUDEINV' ? 790 : 430])) }
}
describe('stock.oilReport — the answer', () => {
  it('the week\'s build or draw by the panel\'s own model, the next report, each group with the week before and a year earlier', () => {
    const a = honest(answerFromOil(envelope(KINDS.oil, oilData(), { as_of: '2031-05-29T14:30:00Z' })))
    expect(a.text).toMatch(/^Draw of 2\.3 million barrels in the week to Wed May 28/)
    expect(a.text).toContain(`Next EIA weekly petroleum report: Tue Jul 15${Y31}, 8:30 AM ET.`)
    expect(a.text).toContain('• Inventories: Crude oil, excluding the SPR')
    expect(a.text).toContain('• Pump prices (U.S. average): Gasoline, regular')
    expect(a.text).toContain(OIL_RECORD)
    expect(a.facts).toMatchObject({ build_draw: 'draw', as_of: '2031-05-29T14:30:00Z' })
  })
  it('not held, refused and an unclean answer are each said', () => {
    expect(answerFromOil(UNAVAILABLE).text).toMatch(/That is not the same as no figure published\.$/)
    expect(answerFromOil(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromOil(envelope(KINDS.oil, { latest: null })).text).toMatch(/did not answer cleanly/)
  })
})

// ── market.analogs → stock.daysLikeToday ───────────────────────────────────────────────────────────────────────────────
const match = (date, similarity, fw) => ({ date, similarity, distance: 0.1, forward_returns: { fwd_5d: null, fwd_10d: null, fwd_20d: null, fwd_60d: null, ...fw }, not_yet: [], measures_then: {} })
const analogsData = (over = {}) => ({ reference_date: '2031-06-02', reference_measures: { breadth_score: 55 }, held: 10, windows: ['fwd_5d', 'fwd_10d', 'fwd_20d', 'fwd_60d'], built_at: READ_AT, age_s: 50000, stale_for: [],
  matches: [match('2031-03-04', 97.3, { fwd_5d: 1.2, fwd_10d: -0.4, fwd_20d: 2.5 }), match('2030-10-07', 91.0, { fwd_5d: -0.8, fwd_10d: 1.1, fwd_20d: 3.0, fwd_60d: 6.2 }),
    match('2030-06-15', 88.5, { fwd_5d: 0.5, fwd_10d: 0.9, fwd_20d: -1.0, fwd_60d: 4.0 })], ...over })
describe('stock.daysLikeToday — the answer', () => {
  it('the record line first, the closest sessions with what followed, a window not reached is "not yet" (never 0), the counts from the list', () => {
    const a = honest(answerFromAnalogs(envelope(KINDS.analogs, analogsData(), { as_of: '2031-06-02T20:00:00Z', freshness: 'historical' }), 3))
    expect(a.text.split('\n')[0]).toBe(ANALOGS_RECORD)
    expect(a.text).toContain('• Tue Mar 4, 2031 (97.3% match): +1.20% / -0.40% / +2.50% / not yet')
    expect(a.text).toContain('60 days later 2 of 2 higher, 0 lower, median +5.10% (2 sessions; 1 not yet)')
    expect(a.text).toContain('3 sessions is a small sample.')
    expect(a.text).toContain('10 matches are held and the closest 3 are in this answer: the least similar are cut.')
    expect(a.text).toContain('The reference session is Mon, Jun 2, 2031')
    expect(a.facts).toEqual({ as_of: '2031-06-02', matches: 3, stale: false })
    expect(a.table.rows[0].fwd_60d).toBe('not yet')
    const few = honest(answerFromAnalogs(envelope(KINDS.analogs, analogsData({ held: 3 }), { stale: true }), 8))
    expect(few.text).toContain('Only 3 sessions came back of the 8 asked for. That is too few to read as a pattern.')
    expect(few.text).toContain('Stale: the held answer is older than the six hours')
  })
  it('no match, not held, refused and an unclean answer are never "no similar days"', () => {
    expect(honest(answerFromAnalogs(envelope(KINDS.analogs, analogsData({ matches: [] })))).text).toContain('No past session in what UCT holds came back for Mon Jun 2, 2031. No record matched')
    expect(answerFromAnalogs(UNAVAILABLE).text).toMatch(/That is not the same as no similar days\.$/)
    expect(answerFromAnalogs(REFUSED).text).toContain(REFUSED_WORDS)
    expect(answerFromAnalogs(envelope(KINDS.analogs, analogsData({ matches: null }))).text).toMatch(/did not answer cleanly/)
  })
  it('the limits and the series lists are the kinds\' own (read from the adapters)', () => {
    expect([pyKind(adapter('insider_market_read')), pyKind(adapter('market_history_read')), pyKind(adapter('analogues_read'))]).toEqual([KINDS.insider, KINDS.history, KINDS.analogs])
    expect([pyKind(adapter('econ_read'), 'ECON_KIND'), pyKind(adapter('econ_read'), 'LIQ_KIND'), pyKind(adapter('econ_read'), 'OIL_KIND')]).toEqual([KINDS.economy, KINDS.liquidity, KINDS.oil])
    expect([pyInt(adapter('insider_market_read'), 'DEFAULT_ROWS'), pyInt(adapter('insider_market_read'), 'MAX_ROWS')]).toEqual([INSIDER_DEFAULT_ROWS, INSIDER_MAX_ROWS])
    expect([pyInt(adapter('market_history_read'), 'DEFAULT_ROWS'), pyInt(adapter('market_history_read'), 'MAX_ROWS')]).toEqual([HISTORY_DEFAULT_ROWS, HISTORY_MAX_ROWS])
    expect([pyInt(adapter('analogues_read'), 'DEFAULT_ROWS'), pyInt(adapter('analogues_read'), 'MAX_ROWS')]).toEqual([ANALOGS_DEFAULT_ROWS, ANALOGS_MAX_ROWS])
    // the adapter's series lists are the panels' own, in their order (a panel that grows a series moves this pin)
    expect(pyTuple(adapter('econ_read'), 'ECON_SYMBOLS')).toEqual([...ECON_SYMBOLS])
    expect(pyTuple(adapter('econ_read'), 'LIQ_SYMBOLS')).toEqual([...LIQ_SYMBOLS])
    expect(pyTuple(adapter('econ_read'), 'OIL_SYMBOLS')).toEqual([...OIL_SYMBOLS])
  })
})

// ── served vs dark ─────────────────────────────────────────────────────────────────────────────────────────────────────
let calls = []
const ENVS = {}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
function wire(kinds) {
  calls = []
  for (const k of Object.keys(ENVS)) delete ENVS[k]
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
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
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest(); _resetTerminalWave7ForTest(); _resetTerminalWave8ForTest(); _resetTerminalWave9ForTest(); _resetTerminalWave10ForTest(); _resetTerminalWave11ForTest();
  _resetTerminalWave12ForTest(); _resetTerminalWave13ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the six kinds and the six capabilities, by name', () => {
    expect(KINDS).toEqual({ insider: 'insider.market', history: 'market.history', economy: 'econ.latest', liquidity: 'market.liquidity', oil: 'market.oil', analogs: 'market.analogs' })
    expect(CAPABILITIES).toEqual({ insider: 'stock.insiderBuying', history: 'stock.marketHistory', economy: 'stock.economyBoard', liquidity: 'stock.liquidityBoard', oil: 'stock.oilReport', analogs: 'stock.daysLikeToday' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'fundamentals', 'analyst.actions', 'fed.watch', 'rates.treasury', 'stock.stats', 'company.deals'], 'other kinds only']])('dark (%j, %s): none of the six is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave13Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave13Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all six served: local-only on BOTH sides, never a plain data read, no enum, inside the manifest text limits', async () => {
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
      for (const p of Object.values(cap.args.properties)) expect(p.enum, name).toBeUndefined()   // an enum's values would join the typo lexicon
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all six kinds are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with its arguments normalised and rows clamped to the kind\'s own limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.insider] = () => envelope(KINDS.insider, insiderData(), { as_of: null })
    ENVS[KINDS.history] = () => envelope(KINDS.history, historyData())
    ENVS[KINDS.economy] = () => envelope(KINDS.economy, econData())
    ENVS[KINDS.liquidity] = () => envelope(KINDS.liquidity, liqData())
    ENVS[KINDS.oil] = () => envelope(KINDS.oil, oilData())
    ENVS[KINDS.analogs] = () => envelope(KINDS.analogs, analogsData())
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.insider, { rows: 999 })).text).toMatch(/^The latest open-market purchases/)
    expect((await run(CAPABILITIES.history, { index: 'Nasdaq', rows: 0 })).text).toMatch(/^S&P 500's corrections/)
    expect((await run(CAPABILITIES.history, { index: null, rows: null })).text).toBeTruthy()
    expect((await run(CAPABILITIES.economy, {})).text).toMatch(/^The economy board/)
    expect((await run(CAPABILITIES.liquidity, {})).text).toMatch(/^Net liquidity/)
    expect((await run(CAPABILITIES.oil, {})).text).toMatch(/^Draw of/)
    expect((await run(CAPABILITIES.analogs, { rows: 3 })).text).toMatch(/^A record of what followed similar days, not a forecast\./)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.insider, { rows: 50 }, 'answer'],
      [KINDS.history, { index: 'NDX', rows: 1 }, 'answer'],
      [KINDS.history, { index: null, rows: 8 }, 'answer'],
      [KINDS.economy, {}, 'answer'],
      [KINDS.liquidity, {}, 'answer'],
      [KINDS.oil, {}, 'answer'],
      [KINDS.analogs, { rows: 3 }, 'answer'],
    ])
  })

  it('an index it does not cover asks, no read without a turn, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect((await inTurn(() => getCapability(CAPABILITIES.history).answer(null, { index: 'the dow', rows: null }, null))).text).toMatch(/^Which index should I read/)
    for (const name of ALL) expect((await getCapability(name).answer(null, { rows: null, index: null }, null)).text, name).toMatch(/needs the Agent's turn/)
    expect(reads()).toEqual([])
    for (const name of ALL) {                                           // the stub refuses every kind
      const a = await inTurn(() => getCapability(name).answer(null, { rows: null, index: null }, null))
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
const wordKeys = namedBy(WAVE13_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them (and no earlier wave's words) */
const ASKS = {
  insider: ['insider buying', 'what are insiders buying', 'insider clusters', 'show me the cluster buys', 'latest insider purchases', 'open-market purchases this week'],
  history: ['market corrections and bear markets', 'how long do bear markets last', 'history of bear markets', 'nasdaq corrections', 'leaders after the correction', 'market history'],
  economy: ['economic data', 'the latest cpi', 'jobs report', 'show me the economy board', 'macro data', 'cpi print', 'initial jobless claims', 'latest gdp'],
  liquidity: ['net liquidity', 'the fed balance sheet', 'reverse repo', 'money supply', 'liquidity conditions', 'the tga'],
  oil: ['weekly oil report', 'crude inventories', 'eia report', 'gasoline inventories', 'refinery utilization', 'crude build'],
  analogs: ['days like today', 'breadth analogues', 'past sessions like this', 'when did the market look like this', 'market analogs'],
}
/** another capability's language: none of the six's words may name these */
const NOT_OURS = [
  'insider buying in NVDA', 'insiders buying for TSLA', 'insider buying by sector', 'sector insider buying', 'insider selling', 'IPO lockups', 'insider unlocks',
  'NVDA corrections', 'how did NVDA do in corrections', 'NVDA drawdowns', 'NVDA stock stats', 'NVDA history', 'price history of NVDA',
  'fed watch', 'fomc statement', 'fed funds rate', 'treasury yields', '10 year yield', 'real yields', 'breakeven inflation', 'treasury auctions',
  'price of oil', 'oil price', 'crude oil positioning', 'cot for crude', 'oil stocks', 'crude oil seasonality', 'what is gold doing',
  'setup analogs', 'historical analogs for a cup and handle', 'similar setups', 'sentiment', 'aaii', 'fear and greed', 'put call ratio', 'naaim',
  'earnings calendar', 'when does NVDA report', 'NVDA balance sheet', 'NVDA liquidity', 'market breadth', 'new highs today', 'the market regime',
  'screen for insider buying', 'alert me on the next cpi', 'add XOM to my watchlist', 'open the ECON panel',
  'what is a bear market', 'what is net liquidity', 'what is cpi', 'explain the eia report', 'define reverse repo',
  'INS', 'MKTH', 'ECON', 'LIQ', 'OIL', 'ANLG', 'SENT', 'insider', 'corrections', 'oil', 'crude', 'liquidity', 'economy', 'analogues', 'macro',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'recent IPOs', 'which themes are rotating in',
  'expected move for NVDA earnings', 'gamma levels for NVDA', 'earnings season today', 'short interest on NVDA', 'NVDA seasonality', 'treasury yields', 'the market regime',
  'confirmed setups on NVDA', 'NVDA events timeline', 'NVDA IV history', 'NVDA dilution', 'NVDA corporate actions', 'IPO calendar', 'treasury auctions', 'fed watch',
  'NVDA stock stats', 'pocket pivots on NVDA', 'NVDA factor exposure', 'NVDA setup history', 'clinical trials for LLY', 'which funds hold NVDA',
  'industry group rank', 'sector crowding', 'earnings by sector', 'estimate revisions by sector', 'richest options', 'IPO lockups', 'futures by trader type',
  'NVDA UCT rating', 'NVDA estimate history', 'price target for NVDA', 'NVDA revenue by segment', 'NVDA fails to deliver', 'mergers involving NVDA']
const EARLIER_WORDS = [TERMINAL_ROUTE_WORDS, WAVE2_ROUTE_WORDS, WAVE3_ROUTE_WORDS, WAVE4_ROUTE_WORDS, WAVE5_ROUTE_WORDS, WAVE6_ROUTE_WORDS, WAVE7_ROUTE_WORDS, WAVE8_ROUTE_WORDS,
  WAVE9_ROUTE_WORDS, WAVE10_ROUTE_WORDS, WAVE11_ROUTE_WORDS, WAVE12_ROUTE_WORDS, { cot: COT_ROUTE_WORDS }].map(namedBy)
/** the Terminal's own keywords for the functions this wave backs that ITS words name, by code (functions.js); every other
 *  keyword of those codes stays with its owner, said: a bare 'oil', 'crude', 'cpi' or 'corrections' could be anything */
const TERMINAL_KEYWORDS = {
  INS: { insider: ['insider buying', 'cluster buys', 'insider clusters', 'insider cluster buys'] },
  MKTH: { history: ['market history', 'past corrections'] },
  ECON: { economy: ['economic data', 'jobs report', 'jobless claims', 'housing starts'] },
  LIQ: { liquidity: ['net liquidity', 'fed balance sheet', 'reverse repo', 'm2', 'money supply'] },
  OIL: { oil: ['crude inventories', 'oil inventories'] },
  ANLG: { analogs: ['days like today', 'breadth analogues'] },
}
const NOT_NAMED = { INS: ['insider', 'insiders', 'form 4'], MKTH: ['corrections', 'bear market', 'drawdowns', 'rallies'], ECON: ['cpi', 'inflation', 'payrolls', 'gdp'],
  LIQ: ['liquidity', 'rrp', 'tga', 'reserves'], OIL: ['oil', 'crude', 'eia', 'gasoline', 'spr'], ANLG: ['analogues', 'analogs', 'similar days', 'what happened next'] }

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the six by action with no word of its own, and it is the 55th of the 56 the server keeps', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([55, 56, true])
    expect(GROUPS.map(x => x.id).slice(52, 55)).toEqual([WAVE11_GROUP, WAVE12_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
    expect([WAVE9_GROUP, WAVE11_GROUP, WAVE12_GROUP].map(id => GROUPS.find(x => x.id === id).actions.length)).toEqual([3, 7, 6])   // held at their sizes
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'earnings', 'fundamentals', 'stock.stats', 'fed.watch', 'rates.treasury'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data group keeps exactly routing.js\'s', async (kinds) => {
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
    expect(ownGroup().words).toEqual(WAVE13_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, WAVE7_GROUP, WAVE8_GROUP, WAVE9_GROUP, WAVE10_GROUP, WAVE11_GROUP, WAVE12_GROUP, 'cot'].map(groupWords)).toEqual([[], [], [], [], [], [], [], [], [], []])
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave13Capabilities()                               // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE13_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE13_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
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

  it('the nearest neighbours keep their own asks', async () => {
    wire([...PAIRS.map(p => p[0]), 'fed.watch', 'rates.treasury', 'rates.realYields', 'groups.crowding', 'stock.stats', 'cot', 'commodity.quote', 'breadth.current', 'ipo.lockups'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(['stock.fomcWatch', 'stock.groupOwnership', 'stock.riskProfile']))   // non-vacuity
    for (const [q, group] of [['fed watch', WAVE9_GROUP], ['sector insider buying', WAVE11_GROUP], ['NVDA stock stats', WAVE10_GROUP], ['IPO lockups', WAVE11_GROUP]]) {
      expect(selectGroups(q).selected, q).toContain(group)
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'both', 'hmm', 'oil', 'insider', 'liquidity', 'economy']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the Terminal codes\' keywords, both ways: this wave names exactly the pinned keywords of the codes it backs, and no keyword of any other code', () => {
    const byCode = Object.fromEntries(FUNCTIONS.map(f => [f.code, (f.keywords || []).map(k => String(k).toLowerCase())]))
    for (const [code, want] of Object.entries(TERMINAL_KEYWORDS)) {
      expect(byCode[code], code).toBeTruthy()
      const named = {}
      for (const kw of byCode[code]) for (const key of wordKeys(kw)) (named[key] = named[key] || []).push(kw)
      expect(named, code).toEqual(want)
      for (const kws of Object.values(want)) for (const kw of kws) expect(byCode[code], `${code}: ${kw}`).toContain(kw)    // the keyword is the Terminal's own
      const left = byCode[code].filter(kw => !wordKeys(kw).length)
      for (const kw of NOT_NAMED[code] || []) expect(left, `${code}: ${kw}`).toContain(kw)
    }
    const others = FUNCTIONS.filter(f => !Object.prototype.hasOwnProperty.call(TERMINAL_KEYWORDS, f.code)).flatMap(f => (f.keywords || []).map(k => `${f.code}: ${k}`))
    expect(others.length).toBeGreaterThan(100)
    expect(others.filter(x => wordKeys(x.split(': ')[1]).length)).toEqual([])
  })

  it('the typo lexicon: registering the six changes no correction of any OTHER capability\'s capreg corpus phrasing, and adds only the pinned name words', async () => {
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'show me the leeders', 'chnage the theme', 'the bord',
      'markt', 'histroy', 'reprot', 'dayz', 'liek', 'todya', 'bord']
    // the REACH of the five new name words, pinned: a misspelling one edit from "insider", "buying", "economy", "liquidity" or "oil"
    // gains that word as a candidate (and keeps every candidate it had). No corpus phrasing is among them (the list above stays
    // unchanged; "market", "history", "report", "days", "like", "today" and "board" were already known).
    const REACH = {
      insidr: ['["inside"]', '["inside","insider"]'], buyng: ['[]', '["buying"]'], economi: ['[]', '["economy"]'], liquidty: ['[]', '["liquidity"]'],
      oill: ['["fill","will"]', '["oil","fill","will"]'],
    }
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = (xs) => { const lex = lexiconFor(null); return xs.map(t => fix(t, lex)) }
    const before = read(texts)
    const reachBefore = read(Object.keys(REACH))
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read(texts)
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    expect(Object.fromEntries(Object.keys(REACH).map((t, i) => [t, [reachBefore[i], read([t])[0]]]))).toEqual(REACH)
    // the six add only their own name words the production catalog does not know; every other word of a summary and a hint is
    // either already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(['buying', 'economy', 'insider', 'liquidity', 'oil'])
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

  it('the earlier waves\' words (and the COT group\'s) name none of this wave\'s asks or phrasings, and these words name none of theirs', () => {
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(EARLIER_WORDS.flatMap(f => f(q)), q).toEqual([])
    const mine = allPhrasings().filter(p => ALL.includes(p.intent.id)).map(p => p.ph.text)
    expect(mine).toHaveLength(24)
    for (const q of mine) expect(EARLIER_WORDS.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(EARLIER_WORDS.flatMap(f => f(q)).length, q).toBeGreaterThan(0)    // non-vacuity: an earlier wave really names it
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no row of the routing-collision table is named by these words (every row belongs to another group)', () => {
    expect(collisions.rows.length).toBeGreaterThan(10)
    const stolen = collisions.rows.filter(r => r.owner !== ROUTE_GROUP && !(r.also || []).includes(ROUTE_GROUP) && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
