// Terminal data wave 14 (gap audit A1-A3) — seven LOCAL-ONLY capabilities over seven model-isolated kinds (MD-1 §4.23):
//   stock.straddleHistory ← options.straddleHistory · stock.optionsPositioning ← options.positioning · stock.edgarFeed ← filings.feed ·
//   stock.congressTrades ← congress.trades · stock.dealsMarket ← market.deals · stock.setupStudy ← market.setupStudy ·
//   stock.periodChange ← market.periodChange.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date, never calls a missing number 0, says when a list is cut, never calls "not held" or a failed read "none",
// never names a vendor and never echoes an envelope note. Routing: no new group (all 56 are in use); each capability joins an
// EXISTING words-only group by action (marketBoards, stockResearch, marketViews) and its words are armed there only while it
// is registered. No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import './terminalWaves'
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
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { _resetCotForTest, COT_ROUTE_WORDS } from './capabilities/cot'
import { _resetHistoryForTest } from './capabilities/history'
import { _resetDescribeForTest } from './capabilities/chartDescribe'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS } from './capabilities/terminalDataWave3'
import { _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS } from './capabilities/terminalDataWave4'
import { _resetTerminalWave5ForTest, WAVE5_ROUTE_WORDS } from './capabilities/terminalDataWave5'
import { _resetTerminalWave6ForTest, WAVE6_ROUTE_WORDS } from './capabilities/terminalDataWave6'
import { _resetTerminalWave7ForTest, WAVE7_ROUTE_WORDS } from './capabilities/terminalDataWave7'
import { _resetTerminalWave8ForTest, WAVE8_ROUTE_WORDS } from './capabilities/terminalDataWave8'
import { _resetTerminalWave9ForTest, WAVE9_ROUTE_WORDS } from './capabilities/terminalDataWave9'
import { _resetTerminalWave10ForTest, WAVE10_ROUTE_WORDS } from './capabilities/terminalDataWave10'
import { _resetTerminalWave11ForTest, WAVE11_ROUTE_WORDS } from './capabilities/terminalDataWave11'
import { _resetTerminalWave12ForTest, WAVE12_ROUTE_WORDS } from './capabilities/terminalDataWave12'
import { _resetTerminalWave13ForTest, WAVE13_ROUTE_WORDS } from './capabilities/terminalDataWave13'
import {
  KINDS, CAPABILITIES, ROUTE_GROUPS, STRADDLE_DEFAULT_ROWS, STRADDLE_MAX_ROWS, FILINGS_DEFAULT_ROWS, FILINGS_MAX_ROWS,
  CONGRESS_DEFAULT_ROWS, CONGRESS_MAX_ROWS, DEALS_DEFAULT_ROWS, DEALS_MAX_ROWS, PERIOD_DEFAULT_ROWS, PERIOD_MAX_ROWS,
  STRADDLE_RECORD, POSITIONING_RECORD, FILINGS_RECORD, CONGRESS_RECORD, DEALS_RECORD, STUDY_RECORD, PERIOD_RECORD,
  answerFromStraddle, answerFromPositioning, answerFromFilings, answerFromCongress, answerFromDeals, answerFromStudy, answerFromPeriod,
  registerTerminalWave14Capabilities, _resetTerminalWave14ForTest, WAVE14_ROUTE_WORDS,
} from './capabilities/terminalDataWave14'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyKind = (src) => /^KIND = "([\w.]+)"/m.exec(src)[1]
const FETCHED = '2031-06-04T15:30:00Z'
const NOTE = 'a provider note that must never be echoed 987654'
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: null, fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
const VENDORS = /\b(?:massive|polygon|finnhub|fmp|financial modeling prep|yahoo|unusual whales|quiver)\b/i
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(VENDORS)
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Jun 4, 2031|2031-06-04/i)
  return a
}

// ── the data, in each kind's own shape ─────────────────────────────────────────────────────────────────────────────────
const straddleData = (over = {}) => ({ symbol: 'QZOP', as_of: '2031-06-02', logging_began: '2031-01-02', sessions_logged: 100,
  straddle: { state: 'held', count: 2, total: 40, cut: true, sessions_without: 0, rows: [
    { date: '2031-06-02', straddle: 8.4, straddle_pct: 4.2, underlying_price: 200, front_dte: 4 },
    { date: '2031-06-01', straddle: null, straddle_pct: null, front_dte: null }] },
  daily_move: { state: 'held', count: 1, total: 1, cut: false, summary: null, summary_note: '1 pair so far; it needs 20.', broken: 2,
    rows: [{ date: '2031-05-29', next: '2031-06-01', implied_move_pct: 1.9, actual_move_pct: -2.4, inside: false }] }, ...over })
const posData = (over = {}) => ({ symbol: 'TST', window: 'month', computed_at: '2031-06-04T15:29:10Z',
  max_pain: { state: 'held', spot: 100, strike_band_pct: 15, count: 1, total: 3, cut: true, contracts_missing_oi: 2,
    expirations: [{ expiration: '2031-06-06', max_pain: 97.5, distance_pct: -2.5 }] },
  levels: { state: 'held', spot: 100, levels: [{ id: 'call_wall', label: 'Call wall', value: 105, unit: 'strike', role: 'Pin' },
    { id: 'implied_move_1d', label: 'Implied 1-day move', value: null, unit: '$ move' }] }, ...over })
const filingsData = (over = {}) => ({ scope: 'market', symbol: null, form: null, state: 'ok', count: 2, total: 9, cut: true, read_at: '2031-06-04T15:00:00Z',
  rows: [{ form: '8-K', company: 'Made-up Filer Inc', ticker: 'QZFL', filed: '2031-06-03', items: [{ code: '2.02', label: 'Results of operations' }], url: 'https://www.sec.gov/x' },
    { form: '10-Q', company: 'Made-up Other Corp', ticker: null, filed: '2031-06-02', items: null, url: null }], ...over })
const congressData = (over = {}) => ({ scope: 'market', symbol: null, state: 'partial', count: 1, total: 1, cut: false, read_at: '2031-06-04T12:00:00Z',
  chambers: { senate: 'ok', house: 'unavailable' }, newest_disclosure: '2031-06-01',
  rows: [{ chamber: 'senate', member: 'Made-up Senator', side: 'buy', symbol: 'QZCG', amount: '$1,001 - $15,000', transaction_date: '2031-05-10', disclosure_date: '2031-06-01' }], ...over })
const dealsData = (over = {}) => ({ part: null, index: null,
  mergers: { state: 'held', count: 1, total: 1, cut: false, feed_cut: true, read_at: '2031-06-03T20:00:00Z',
    rows: [{ date: '2031-06-02', acquirer: { sym: 'QZAQ', name: 'Made-up Acquirer' }, target: { sym: null, name: 'Made-up Target' } }] },
  index_changes: { state: 'not_held', rows: [], count: 0, total: 0, cut: false }, ...over })
const hz = (n, below = false) => ({ n, below_floor: below, win_rate: below ? null : 55, avg_pct: below ? null : 2.1, baseline_avg_pct: below ? null : 0.9 })
const studyData = (over = {}) => ({ data_through: '2031-05-29', built_at: '2031-06-01T02:00:00Z', count: 2, setups: [
  { id: 'qz', name: 'Made-up breakout', state: 'ok', groups: [{ phase: 'correction', horizons: { 5: hz(40), 20: hz(12, true), 60: hz(12, true) } },
    { phase: 'all', horizons: { 5: hz(90), 20: hz(90), 60: hz(90) } }] },
  { id: 'qp', name: 'Made-up pivot', state: 'capped', groups: [] }], ...over })
const periodData = (over = {}) => ({ start: '2031-01-02', end: '2031-03-03', start_day: '2031-01-02', end_day: '2031-03-03', side: 'gainers', held: 'fresh',
  built_at: '2031-03-03T22:00:00Z', partial: false, count: 2, total: 3000, cut: true,
  rows: [{ sym: 'QZUP', period_change: 120.5, start_close: 10, end_close: 22.05, sector: 'Made-up' }, { sym: 'QZUQ', period_change: 80, start_close: null, end_close: 9 }], ...over })

describe('the answers', () => {
  it('straddle history: newest first, a missing straddle is "no straddle" never $0, the cut, the broken pairs and the summary sentence', () => {
    const a = honest(answerFromStraddle(envelope(KINDS.straddle, straddleData())))
    expect(a.text).toContain("QZOP's options history from UCT's options log, newest logged session Jun 2, 2031 (the log began Jan 2, 2031):")
    expect(a.text).toContain('• Jun 2, 2031: $8.40, 4.20% of the stock, 4 days to its expiry')
    expect(a.text).toContain('• Jun 1, 2031: no straddle')
    expect(a.text).toContain('40 sessions are held and the newest 2 are in this answer: the history is cut from the old end.')
    expect(a.text).toContain('Implied against actual one-day moves: 1 pair so far; it needs 20.')
    expect(a.text).toContain('implied +1.90%, actual -2.40% (outside)')
    expect(a.text).toContain('2 pairs are broken by a session the log did not record')
    expect(a.text).toContain(STRADDLE_RECORD)
    expect(a.facts).toEqual({ symbol: 'QZOP', as_of: '2031-06-02', straddles: 2, pairs: 1 })
  })
  it('max pain: the build time is UCT\'s own, the far expiries are cut, a missing open interest is never 0, a missing level is "not stated"', () => {
    const a = honest(answerFromPositioning(envelope(KINDS.maxPain, posData())))
    expect(a.text).toMatch(/^TST's options positioning for the month window, worked out by UCT at .+ \(UCT's own time\)/)
    expect(a.text).toContain('• Jun 6, 2031: $97.50 (-2.50% from the stock price then)')
    expect(a.text).toContain('3 expiries are held and the nearest 1 are in this answer: the far ones are cut.')
    expect(a.text).toContain('2 contracts carry no open interest and are left out, never counted as 0.')
    expect(a.text).toContain('• Call wall: $105.00 (Pin)')
    expect(a.text).toContain('• Implied 1-day move: not stated')
    expect(a.text).toContain('the one the chain carried then, never a quote')
    expect(a.text).toContain(POSITIONING_RECORD)
    const off = honest(answerFromPositioning(envelope(KINDS.maxPain, posData({ levels: { state: 'off' } }))))
    expect(off.text).toContain('The positioning levels are switched off on this server.')
  })
  it('SEC filings: the market\'s newest with each company, the item labels, the cut; one company with none is never "no filings"', () => {
    const a = honest(answerFromFilings(envelope(KINDS.filings, filingsData())))
    expect(a.text).toContain('• Jun 3, 2031: 8-K by Made-up Filer Inc (QZFL): Results of operations')
    expect(a.text).toContain('9 filings are held and the newest 2 are in this answer: the list is cut from the old end.')
    expect(a.text).toContain(FILINGS_RECORD)
    const none = honest(answerFromFilings(envelope(KINDS.filings, filingsData({ scope: 'stock', symbol: 'QZFL', form: 'S-1', state: 'none_in_scope', rows: [], count: 0, total: 0, cut: false }))))
    expect(none.text).toContain('No S-1 filing is in what UCT holds. That is not the same as no filings.')
  })
  it('congressional trades: the range as disclosed (never one figure), a missing chamber named, none is never "no trades"', () => {
    const a = honest(answerFromCongress(envelope(KINDS.congress, congressData(), { status: 'partial' })))
    expect(a.text).toContain('• Made-up Senator (Senate) bought QZCG, $1,001 - $15,000, traded May 10, 2031, disclosed Jun 1, 2031')
    expect(a.text).toContain('The House records could not be read, so only the other chamber is stated.')
    expect(a.text).toContain(CONGRESS_RECORD)
    const none = honest(answerFromCongress(envelope(KINDS.congress, congressData({ symbol: 'QZNO', rows: [], count: 0, total: 0, chambers: { senate: 'ok', house: 'ok' } }))))
    expect(none.text).toContain('No congressional disclosure in what UCT holds names QZNO. That is not the same as no trades.')
  })
  it('the market\'s deals: each part with its own state, a part not held is said, older deals exist is said', () => {
    const a = honest(answerFromDeals(envelope(KINDS.deals, dealsData())))
    expect(a.text).toContain('• Jun 2, 2031: Made-up Acquirer (QZAQ) and Made-up Target')
    expect(a.text).toContain('Older announced deals exist than UCT holds.')
    expect(a.text).toContain('The index changes are not held on the server yet (this answer never builds them): open IDXC in UCT, then ask again.')
    expect(a.text).toContain(DEALS_RECORD)
    expect(a.facts).toEqual({ deals: 1, index_changes: null })
  })
  it('the setup study: below the floor is "too few signals", never 0; a capped setup has no figures; the hindsight is said', () => {
    const a = honest(answerFromStudy(envelope(KINDS.study, studyData())))
    expect(a.text).toContain('• Made-up breakout: in corrections too few signals (12); in all phases 55% up, average +2.1% (the baseline +0.9%)')
    expect(a.text).toContain('• Made-up pivot: no figures (it fired too often for the study to store).')
    expect(a.text).toContain('The market phase is assigned with hindsight')
    expect(a.text).toContain(STUDY_RECORD)
  })
  it('the change between two dates: biggest first, the cut, a missing close is never 0', () => {
    const a = honest(answerFromPeriod(envelope(KINDS.period, periodData())))
    expect(a.text).toMatch(/^The biggest gainers from the close of Jan 2, 2031 to the close of Mar 3, 2031, as UCT ranked every US common stock \(built .+, UCT's own time\):/)
    expect(a.text).toContain('• QZUP: +120.50% ($10.00 to $22.05), Made-up')
    expect(a.text).toContain('• QZUQ: +80.00%\n')
    expect(a.text).toContain('3,000 stocks are ranked and the 2 biggest gainers are in this answer.')
    expect(a.text).toContain(PERIOD_RECORD)
  })
  it.each([
    ['straddle', answerFromStraddle, 'That is not the same as no options history.'], ['maxPain', answerFromPositioning, 'That is not the same as none.'],
    ['filings', answerFromFilings, 'That is not the same as no filings.'], ['congress', answerFromCongress, 'That is not the same as no trades.'],
    ['deals', answerFromDeals, 'That is not the same as none.'], ['study', answerFromStudy, 'That is not the same as no record.'],
    ['period', answerFromPeriod, 'That is not the same as no change.'],
  ])('%s: not held, refused and an unclean answer are each said, never "none"', (key, fn, tail) => {
    expect(fn(UNAVAILABLE).text.endsWith(tail)).toBe(true)
    expect(fn(UNAVAILABLE).text).toMatch(/^I couldn't read /)
    expect(fn(REFUSED).text).toContain(REFUSED_WORDS)
    expect(fn(envelope(KINDS[key], { rows: 'x', straddle: null, max_pain: null, mergers: 7, setups: 'x' })).text).toMatch(/did not answer cleanly/)
  })
  it('the limits and kind names are the adapters\' own', () => {
    const files = { straddle: 'straddle_history_read', maxPain: 'options_positioning_read', filings: 'filings_feed_read', congress: 'congress_read',
      deals: 'market_deals_read', study: 'setup_study_read', period: 'period_change_read' }
    for (const [k, f] of Object.entries(files)) expect(pyKind(adapter(f)), k).toBe(KINDS[k])
    expect([pyInt(adapter('straddle_history_read'), 'DEFAULT_ROWS'), pyInt(adapter('straddle_history_read'), 'MAX_ROWS')]).toEqual([STRADDLE_DEFAULT_ROWS, STRADDLE_MAX_ROWS])
    expect([pyInt(adapter('filings_feed_read'), 'DEFAULT_ROWS'), pyInt(adapter('filings_feed_read'), 'MAX_ROWS')]).toEqual([FILINGS_DEFAULT_ROWS, FILINGS_MAX_ROWS])
    expect([pyInt(adapter('congress_read'), 'DEFAULT_ROWS'), pyInt(adapter('congress_read'), 'MAX_ROWS')]).toEqual([CONGRESS_DEFAULT_ROWS, CONGRESS_MAX_ROWS])
    expect([pyInt(adapter('market_deals_read'), 'DEFAULT_ROWS'), pyInt(adapter('market_deals_read'), 'MAX_ROWS')]).toEqual([DEALS_DEFAULT_ROWS, DEALS_MAX_ROWS])
    expect([pyInt(adapter('period_change_read'), 'DEFAULT_ROWS'), pyInt(adapter('period_change_read'), 'MAX_ROWS')]).toEqual([PERIOD_DEFAULT_ROWS, PERIOD_MAX_ROWS])
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
  _resetTerminalWave12ForTest(); _resetTerminalWave13ForTest(); _resetTerminalWave14ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes', 'themes', 'company.deals', 'stock.setupHistory', 'group.drill', 'levels.gamma'], 'other kinds only']])('dark (%j, %s): none of the seven is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave14Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave14Capabilities()).toEqual([])
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all seven served: local-only on BOTH sides, in its existing group, no enum, inside the manifest text limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const turnPy = py('api/services/uct_agent/turn.py')
    const dataReads = /^DATA_READ_ACTIONS = frozenset\(\{([\s\S]*?)^\}\)/m.exec(turnPy)[1]
    for (const key of KEYS) {
      const [kind, name] = [KINDS[key], CAPABILITIES[key]]
      const cap = getCapability(name)
      expect(cap, name).toBeTruthy()
      expect(cap.query && cap.localOnly, name).toBe(true)
      expect(groupOfAction(name), name).toBe(ROUTE_GROUPS[key])
      expect(cap.summary.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
      expect(cap.hints.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
      expect(cap.hints, name).toMatch(/never today/)
      expect(cap.hints, name).toMatch(/reply: one short line, no figures\.$/)
      for (const p of Object.values(cap.args.properties)) expect(p.enum, name).toBeUndefined()
      expect(handshake.isolated_kinds, kind).toContain(kind)
      expect(handshake.local_only_actions, name).toContain(name)
      expect(dataReads.includes(`"${name}"`), name).toBe(false)
    }
  })

  it('each answer makes ONE read of its own kind, with its arguments normalised and rows clamped to the kind\'s own limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.straddle] = () => envelope(KINDS.straddle, straddleData())
    ENVS[KINDS.maxPain] = () => envelope(KINDS.maxPain, posData())
    ENVS[KINDS.filings] = () => envelope(KINDS.filings, filingsData())
    ENVS[KINDS.congress] = () => envelope(KINDS.congress, congressData())
    ENVS[KINDS.deals] = () => envelope(KINDS.deals, dealsData())
    ENVS[KINDS.study] = () => envelope(KINDS.study, studyData())
    ENVS[KINDS.period] = () => envelope(KINDS.period, periodData())
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.straddle, { symbol: '$qzop', rows: 999 })).text).toMatch(/^QZOP's options history/)
    expect((await run(CAPABILITIES.maxPain, { symbol: 'tst', window: 'Weekly' })).text).toMatch(/^TST's options positioning/)
    expect((await run(CAPABILITIES.maxPain, { symbol: 'TST', window: null })).text).toBeTruthy()
    expect((await run(CAPABILITIES.filings, { symbol: null, form: '8k', rows: 0 })).text).toMatch(/^The newest SEC filings/)
    expect((await run(CAPABILITIES.filings, { symbol: 'brk.b', form: null, rows: null })).text).toBeTruthy()
    expect((await run(CAPABILITIES.congress, { symbol: null, rows: 3 })).text).toMatch(/^The newest congressional/)
    expect((await run(CAPABILITIES.deals, { part: 'M&A', index: null, rows: 500 })).text).toMatch(/^The latest announced/)
    expect((await run(CAPABILITIES.study, { phase: 'corrections' })).text).toMatch(/^How each setup acted/)
    expect((await run(CAPABILITIES.period, { start: '2031-01-02', end: '2031-03-03', side: 'worst', rows: null })).text).toMatch(/^The biggest gainers/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.straddle, { symbol: 'QZOP', rows: 60 }, 'answer'],
      [KINDS.maxPain, { symbol: 'TST', window: 'week' }, 'answer'],
      [KINDS.maxPain, { symbol: 'TST', window: 'month' }, 'answer'],
      [KINDS.filings, { symbol: null, form: '8-K', rows: 1 }, 'answer'],
      [KINDS.filings, { symbol: 'BRK-B', form: null, rows: 15 }, 'answer'],
      [KINDS.congress, { symbol: null, rows: 3 }, 'answer'],
      [KINDS.deals, { part: 'mergers', index: null, rows: 50 }, 'answer'],
      [KINDS.study, { phase: 'correction' }, 'answer'],
      [KINDS.period, { start: '2031-01-02', end: '2031-03-03', side: 'losers', rows: 15 }, 'answer'],
    ])
  })

  it('an argument it cannot read asks, no read without a turn, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.straddle, { symbol: 'not a ticker', rows: null })).text).toMatch(/^Which stock's options history/)
    expect((await run(CAPABILITIES.maxPain, { symbol: 'TST', window: 'next year' })).text).toMatch(/^Which window should I read/)
    expect((await run(CAPABILITIES.filings, { symbol: null, form: '13F', rows: null })).text).toMatch(/^Which form should I read/)
    expect((await run(CAPABILITIES.deals, { part: null, index: 'russell', rows: null })).text).toMatch(/^Which index should I read/)
    expect((await run(CAPABILITIES.study, { phase: 'bull market' })).text).toMatch(/^Which phase should I read/)
    expect((await run(CAPABILITIES.period, { start: '2031-03-03', end: '2031-01-02', side: null, rows: null })).text).toMatch(/^Which two dates should I compare/)
    expect((await run(CAPABILITIES.period, { start: '2031-02-30', end: '2031-03-03', side: null, rows: null })).text).toMatch(/^Which two dates/)
    const good = { symbol: 'QZOP', rows: null, window: null, form: null, part: null, index: null, phase: null, start: '2031-01-02', end: '2031-03-03', side: null }
    for (const name of ALL) expect((await getCapability(name).answer(null, good, null)).text, name).toMatch(/needs the Agent's turn/)
    expect(reads()).toEqual([])
    for (const name of ALL) {
      const a = await run(name, good)
      expect(a.text, name).toMatch(/^I couldn't read .*: that request wasn't allowed for this question, so nothing was read\./)
    }
    expect(reads()).toHaveLength(ALL.length)
  })
})

// ── routing ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const HOSTS = [...new Set(Object.values(ROUTE_GROUPS))]
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE14_ROUTE_WORDS)
const ASKS = {
  straddle: ['NVDA straddle history', 'straddle history for TSLA', 'implied vs actual moves for AAPL', 'options history for NVDA', 'history of the straddle on AMD'],
  maxPain: ['max pain for NVDA', 'what is the max pain on SPY this week', 'maximum pain TSLA', 'options positioning for AAPL', 'options positioning levels on QQQ'],
  filings: ['SEC filings for NVDA', 'latest sec filings', 'edgar filings for TSLA', 'show me the filings feed', 'latest 8-Ks', 'recent 10-Qs'],
  congress: ['congressional trades', 'what are senators buying', 'congress trading in NVDA', 'stock act disclosures', 'politicians trades this month', 'house members trades'],
  deals: ['latest mergers', 'recent acquisitions', 'm&a activity', 'latest m&a deals', 'index additions', 'recent index changes', 'newest takeovers'],
  study: ['how do breakouts act in corrections', 'how did pullbacks perform', 'setup statistics', 'setup win rates', 'breakouts in bear markets', 'how did breakouts do in uptrends'],
  period: ['top gainers between jan 5 and mar 3', 'biggest losers from 2024-01-02 to 2024-06-28', 'best performers from 1/2/2025 to 3/31/2025', 'between feb 1 and apr 30 who were the top gainers'],
}
const NOT_OURS = [
  'expected move for NVDA earnings', 'NVDA IV history', 'NVDA iv rank', 'gamma levels for NVDA', 'NVDA call wall', 'what is max pain', 'explain a straddle',
  'NVDA dilution', 'which funds hold NVDA', 'insider buying', 'NVDA insider buying', 'what is an 8-K', 'sec filing search for buybacks', 'filings',
  'mergers involving NVDA', 'NVDA index changes', 'is NVDA in the s&p 500', 'NVDA setup history', 'pocket pivots on NVDA', 'how did NVDA do',
  'top gainers over 60 days', 'top gainers this year', 'gainers today', 'ytd leaders', 'screen for max pain', 'alert me on the next 8-K',
  'add NVDA to my watchlist', 'dealer positioning levels on QQQ', 'straddle prices for TSLA', 'full text search of sec filings for buybacks', 'open the POS panel', 'OHIS', 'POS', 'FEED', 'CONG', 'MNA', 'IDXC', 'SETH', 'PCHG', 'congress', 'deals', 'setups', 'straddle',
]
const EARLIER = [TERMINAL_ROUTE_WORDS, WAVE2_ROUTE_WORDS, WAVE3_ROUTE_WORDS, WAVE4_ROUTE_WORDS, WAVE5_ROUTE_WORDS, WAVE6_ROUTE_WORDS, WAVE7_ROUTE_WORDS, WAVE8_ROUTE_WORDS,
  WAVE9_ROUTE_WORDS, WAVE10_ROUTE_WORDS, WAVE11_ROUTE_WORDS, WAVE12_ROUTE_WORDS, WAVE13_ROUTE_WORDS, { cot: COT_ROUTE_WORDS }].map(namedBy)
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'dark pool levels on NVDA', 'expected move for NVDA earnings', 'gamma levels for NVDA',
  'earnings season today', 'short interest on NVDA', 'NVDA IV history', 'NVDA dilution', 'IPO calendar', 'NVDA setup history', 'which funds hold NVDA',
  'richest options', 'mergers involving NVDA', 'insider buying', 'market corrections and bear markets', 'days like today']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('no new group: each capability is listed by action in its EXISTING words-only group, and the group budget holds', () => {
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.length, max]).toEqual([56, 56])
    for (const key of KEYS) {
      const g = GROUPS.find(x => x.id === ROUTE_GROUPS[key])
      expect(g.wordsOnly && g.fillLast, key).toBe(true)
      expect(g.actions, key).toContain(CAPABILITIES[key])
      for (const other of GROUPS.filter(x => x.id !== g.id)) expect(other.actions || [], `${other.id}: ${key}`).not.toContain(CAPABILITIES[key])
    }
    expect(HOSTS.map(id => GROUPS.find(x => x.id === id).actions.length)).toEqual([6, 8, 6])
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'levels.gamma', 'company.deals', 'group.drill'], 'other kinds only']])('dark (%j, %s): the host groups carry none of these words', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const id of HOSTS) for (const re of Object.values(WAVE14_ROUTE_WORDS).flat()) expect(groupWords(id), id).not.toContain(re)
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordsSelect(ROUTE_GROUPS[key], q), q).toBe(false)
  })

  it.each(KEYS)('served %s alone: only its own words are armed on its own group, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const g = ROUTE_GROUPS[key]
    for (const k of KEYS) for (const re of WAVE14_ROUTE_WORDS[k]) expect(groupWords(ROUTE_GROUPS[k]).includes(re), `${key}: ${k}`).toBe(k === key)
    const n = groupWords(g).length
    registerTerminalWave14Capabilities()
    expect(groupWords(g)).toHaveLength(n)
    reset()
    for (const re of WAVE14_ROUTE_WORDS[key]) expect(groupWords(g)).not.toContain(re)
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE14_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toEqual([key])
  })

  it('served: each ask routes its capability under v1 and v2, and the budget never cuts its group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const [key, asks] of Object.entries(ASKS)) {
      for (const q of asks) {
        expect(selectGroups(q).selected, q).toContain(ROUTE_GROUPS[key])
        for (const route of [routeManifest, routeManifestV2]) {
          const r = route(full, q, ROUTE_OPTS())
          expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITIES[key])
          expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain(ROUTE_GROUPS[key])
        }
      }
    }
  })

  it('served: the words never name another capability\'s language', () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
  })

  it('served: the fill for a message nothing recognised never carries these capabilities', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'both', 'hmm', 'filings', 'congress', 'deals', 'straddle']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  it('the earlier waves\' words (and COT\'s) name none of these asks, and these words name none of theirs', () => {
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(EARLIER.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(EARLIER.flatMap(f => f(q)).length, q).toBeGreaterThan(0)
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no OTHER capability\'s capreg corpus phrasing, routing-collision row or Terminal keyword of another code is named by these words', () => {
    const others = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text))]
    expect(others.length).toBeGreaterThan(500)
    expect(others.filter(t => wordKeys(t).length)).toEqual([])
    const key = Object.fromEntries(KEYS.map(k => [CAPABILITIES[k], k]))
    const ownPhrasings = allPhrasings().filter(p => ALL.includes(p.intent.id))
    expect(ownPhrasings).toHaveLength(28)                                               // four corpus phrasings per capability
    for (const p of ownPhrasings) {
      expect(wordKeys(p.ph.text), p.ph.text).toEqual([key[p.intent.id]])
      expect(EARLIER.flatMap(f => f(p.ph.text)), p.ph.text).toEqual([])
    }
    expect(collisions.rows.filter(r => wordKeys(r.text).length).map(r => r.text)).toEqual([])
    const mine = new Set(['OHIS', 'POS', 'FEED', 'CF', 'CONG', 'MNA', 'IDXC', 'SETH', 'PCHG'])
    const kws = FUNCTIONS.filter(f => !mine.has(f.code)).flatMap(f => (f.keywords || []).map(k => `${f.code}: ${String(k).toLowerCase()}`))
    expect(kws.length).toBeGreaterThan(100)
    expect(kws.filter(x => wordKeys(x.split(': ')[1]).length)).toEqual([])
  })

  it('the typo lexicon: registering the seven changes no correction of any capreg corpus phrasing, and adds only the pinned name words', async () => {
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'show me the leeders', 'chnage the theme', 'markt', 'histroy']
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = (xs) => { const lex = lexiconFor(null); return xs.map(t => fix(t, lex)) }
    const before = read(texts)
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read(texts)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(LEXICON_ADDS)
  })
})
/** the name words the seven add to the typo lexicon (pinned: a new one changes what a misspelling may be corrected to) */
const LEXICON_ADDS = ['congress', 'deals', 'dte', 'edgar', 'feed', 'positioning', 'straddle']
