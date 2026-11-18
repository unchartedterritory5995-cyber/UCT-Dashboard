// Terminal data wave 1 — the five capabilities over `sectors.performance`, `analyst.actions`, `highsLows.session`,
// `leaders.longRun` and `levels.darkpool`: the member's answer (the data's own time or why there is none; never live /
// now; the analyst list never "today's"; a failed read never "nothing to show"; an envelope's notes never echoed),
// rows shaped by the terminal panels' own pure helpers, served vs dark (each registers only while the server lists ITS
// kind), local-only on both sides for the four isolated kinds, the manifest text limits, one read per answer, and the
// cross-file facts read from the other file (never retyped).
// Routing: the four local-only capabilities' own words are on the data group only while each is registered (a dark server's
// routing is routing.js's own), every plain ask reaches its capability under v1 and v2, and the words stay off other
// capabilities' language (the member's plan, breadth's measures, the Screener, the chart's dark-pool setting).
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
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'
import handshake from './__fixtures__/program/isolation.json'
import { LONG_RUN_LENS_KEYS } from '../pages/terminal/panels/longRunModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import {
  SECTOR_CAPABILITY, SECTOR_KIND, SECTOR_PERIOD_KEYS, answerFromSectors, sectorsServed, registerTerminalDataCapability, _resetTerminalDataForTest,
} from './capabilities/terminalData'
import {
  KINDS, CAPABILITIES, ANALYST_SIDES, NOT_52_WEEK, answerFromAnalystActions, answerFromHighsLows, answerFromLeaders, answerFromDarkPool,
  registerTerminalLocalCapabilities, _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS,
} from './capabilities/terminalDataLocal'

registerBuiltins()
const sectorsPanel = await import('../pages/terminal/panels/SectorsPanel')
const upgradesPanel = await import('../pages/terminal/panels/UpgradesPanel')
const hiloPanel = await import('../pages/terminal/panels/HighsLowsPanel')

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const FETCHED = '2026-11-13T15:30:00Z'               // 10:30 AM ET
const NOTE = 'a provider note that must never be echoed 987654'
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: null, fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, data, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
/** every answer of this wave: no live / now wording, and never an envelope note */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  return a
}

// ── sectors.performance → stock.sectorPerformance ──────────────────────────────────────────────────────────────────────
const SECTORS = [['Technology', 'XLK', 2.1], ['Financials', 'XLF', 1.4], ['Energy', 'XLE', 0.9], ['Healthcare', 'XLV', 0.5], ['Industrials', 'XLI', 0.25],
  ['Consumer Discretionary', 'XLY', 0], ['Consumer Staples', 'XLP', -0.2], ['Materials', 'XLB', -0.45], ['Real Estate', 'XLRE', -0.8],
  ['Utilities', 'XLU', -1.15], ['Communication Services', 'XLC', -1.6]].map(([sector, ticker, change_pct]) => ({ sector, ticker, change_pct }))
const sectorEnv = (over = {}, envOver = {}) => envelope(SECTOR_KIND, { period: '1M', sessions: 21, sectors: SECTORS, missing: [], ...over }, envOver)

describe('stock.sectorPerformance — the answer', () => {
  it('ranks all the funds with the panel helper, strongest and weakest in the text, every fund in the table', () => {
    const a = honest(answerFromSectors(sectorEnv(), sectorsPanel))
    expect(a.text.split('\n')[0]).toBe('Sector funds ranked by change, 1 month (21 sessions of daily closes), 11 of them:')
    expect(a.text).toContain('Strongest: 1. Technology (XLK) +2.10%; 2. Financials (XLF) +1.40%; 3. Energy (XLE) +0.90%.')
    expect(a.text).toContain('Weakest: 9. Real Estate (XLRE) −0.80%; 10. Utilities (XLU) −1.15%; 11. Communication Services (XLC) −1.60%.')
    expect(a.table.rows).toHaveLength(11)
    expect(a.table.rows[5]).toEqual({ rank: 6, sector: 'Consumer Discretionary', fund: 'XLY', change: '0.00%' })
    expect(a.present.kind).toBe('metrics')
    expect(a.present.items[0]).toMatchObject({ label: 'Technology (XLK)', value: '+2.10%' })
    expect(a.facts.rows.map(r => r.fund)).toEqual(sectorsPanel.sectorRows({ sectors: SECTORS }).rows.map(r => r.sym))
  })
  it('says there is no data time instead of stating one', () => {
    const a = answerFromSectors(sectorEnv(), sectorsPanel)
    expect(a.text).toContain("UCT's sector ranking carries no data time")
    expect(a.text).not.toMatch(/\bas of\b/i)
  })
  it('a fund the server could not read is named, never ranked as zero', () => {
    const a = honest(answerFromSectors(sectorEnv({ sectors: SECTORS.slice(0, 9), missing: ['Utilities', 'Communication Services'] }, { status: 'partial' }), sectorsPanel))
    expect(a.text).toContain('Not ranked, because their daily bars could not be read: Utilities and Communication Services.')
    expect(a.facts).toMatchObject({ ranked: 9, partial: true, missing: ['Utilities', 'Communication Services'] })
    expect(a.table.rows.map(r => r.fund)).not.toContain('XLU')
  })
  it('refused / unavailable: fixed words keyed on the status, no figure, no table', () => {
    expect(honest(answerFromSectors(REFUSED, sectorsPanel)).text).toBe("I couldn't read UCT's sector ranking: that request wasn't allowed for this question, so nothing was read. No figure is stated.")
    const u = honest(answerFromSectors(UNAVAILABLE, sectorsPanel))
    expect(u.text).toMatch(/^I couldn't read UCT's sector ranking: it is not available from UCT's data at the moment .*No figure is stated\.$/)
    expect(u.table).toBeUndefined()
    expect(answerFromSectors(null, sectorsPanel).text).toMatch(/No figure is stated\.$/)
  })
  it('the periods offered are the SCTR panel\'s own (one list, read from the panel)', () => {
    expect(SECTOR_PERIOD_KEYS).toEqual(Object.keys(sectorsPanel.SECTOR_PERIODS))
  })
})

// ── analyst.actions → stock.analystActions ─────────────────────────────────────────────────────────────────────────────
const act = (ticker, action, o = {}) => ({ ticker, action, firm: o.firm ?? 'Example Securities', from_rating: 'from' in o ? o.from : 'Hold', to_rating: o.to ?? 'Buy', price_target: 'pt' in o ? o.pt : '$120', isolated: true })
const analystEnv = (over = {}, envOver = {}) => envelope(KINDS.analyst, {
  upgrades: [act('AAA', 'Upgrade')], downgrades: [act('CCC', 'Downgrade', { firm: 'Sample Capital', from: 'Buy', to: 'Hold', pt: null })],
  pt_changes: [act('DDD', 'Raises PT', { from: null, pt: 150 })], summary: { upgrades: 1, downgrades: 1, pt_changes: 1 }, side: 'all',
  wire_date: '2026-11-13', wire_status: 'fresh', isolated: true, ...over,
}, { as_of: '2026-11-13T05:00:00Z', isolated: true, ...envOver })

describe('stock.analystActions — the answer', () => {
  it('names the morning wire by its own date and never calls the list today\'s', () => {
    const a = honest(answerFromAnalystActions(analystEnv(), upgradesPanel))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('Analyst actions from the morning wire of Fri, Nov 13, 2026: 1 upgrade or new coverage call, 1 downgrade and 1 price-target change.')
    expect(lines[1]).toBe('• AAA — Upgrade by Example Securities: Hold to Buy, target $120.00.')
    expect(lines[2]).toBe('• CCC — Downgrade by Sample Capital: Buy to Hold.')
    expect(lines[3]).toBe('• DDD — Target raised by Example Securities: Buy, target $150.00.')
    expect(a.text).toContain('The list is served unchanged until the next morning wire arrives.')
    expect(a.text).not.toMatch(/\btoday/i)
    expect(a.table.rows).toHaveLength(3)
    expect(a.facts).toMatchObject({ wire_date: '2026-11-13', stale: false, counts: { upgrades: 1, downgrades: 1, targets: 1 } })
    expect(a.facts.rows.map(r => r.symbol)).toEqual(upgradesPanel.analystActions(analystEnv().data).rows.map(r => r.sym))
  })
  it('a wire that is behind is said to be stale; an undated list says it cannot be dated', () => {
    const s = honest(answerFromAnalystActions(analystEnv({ wire_status: 'stale', wire_date: '2026-11-12' }, { stale: true, as_of: '2026-11-12T05:00:00Z' }), upgradesPanel))
    expect(s.text).toContain('Stale: a newer morning wire was due after Thu, Nov 12, 2026, so this is not the latest list.')
    const u = honest(answerFromAnalystActions(analystEnv({ wire_date: null, wire_status: 'unknown' }, { stale: true, as_of: null }), upgradesPanel))
    expect(u.text.split('\n')[0]).toMatch(/^Analyst actions from the last morning wire held on this server: /)
    expect(u.text).toContain('This list carries no date, so I cannot say which morning it is from.')
  })
  it('an empty dated list is "none listed"; a failed read is never that', () => {
    const e = honest(answerFromAnalystActions(analystEnv({ upgrades: [], downgrades: [], pt_changes: [] }), upgradesPanel, { side: 'downgrades' }))
    expect(e.text.split('\n')[0]).toBe('Analyst actions from the morning wire of Fri, Nov 13, 2026: no downgrades are listed.')
    expect(e.table).toBeUndefined()
    const u = honest(answerFromAnalystActions(UNAVAILABLE, upgradesPanel))
    expect(u.text).toMatch(/^I couldn't read the morning wire's analyst actions: they are not available .*No figure is stated\.$/)
    expect(u.text).not.toMatch(/no analyst actions are listed/)
    expect(honest(answerFromAnalystActions(REFUSED, upgradesPanel)).text).toMatch(/that request wasn't allowed for this question/)
  })
  it('each side the member can ask for is one of the kind\'s own (read from the adapter, never retyped)', () => {
    const src = py('api/services/uct_agent/marketdata/analyst_actions.py')
    const buckets = /^BUCKETS = \(([^)]+)\)$/m.exec(src)[1].match(/"[a-z_]+"/g).map(s => s.slice(1, -1))
    expect(src).toMatch(/^SIDES = \("all",\) \+ BUCKETS$/m)
    expect(ANALYST_SIDES).toEqual(Object.keys(upgradesPanel.UPGRADE_KINDS))
    expect(ANALYST_SIDES.map(s => upgradesPanel.UPGRADE_KINDS[s].bucket).filter(Boolean).sort()).toEqual([...buckets].sort())
  })
})

// ── highsLows.session → stock.sessionHighsLows ─────────────────────────────────────────────────────────────────────────
const hrow = (sym, count, dir, o = {}) => ({ sym, price: o.price ?? 10.5, pct: o.pct ?? 2.5, count, ts: '2026-11-13T10:29:58-05:00', dir, isolated: true })
const hiloEnv = (over = {}, envOver = {}) => envelope(KINDS.highsLows, {
  window: 'rth', active: true, date: '2026-11-13', asof: '2026-11-13T10:29:58.123456-05:00', tick_at: '2026-11-13T15:29:58Z', group: null, value: null,
  highs: [hrow('AAA', 12, 'high'), hrow('BBB', 1, 'high', { price: 1234.5, pct: 0.75 })], lows: [hrow('CCC', 3, 'low', { pct: -4.1 })],
  highs_total: 40, lows_total: 2, isolated: true, ...over,
}, { isolated: true, ...envOver })

describe('stock.sessionHighsLows — the answer', () => {
  it('counts of the session, with the scanner\'s own polling time and the not-52-week line', () => {
    const a = honest(answerFromHighsLows(hiloEnv(), hiloPanel))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('New highs and new lows of the day (regular session), Fri, Nov 13, 2026: 40 stocks at a new high, 2 stocks at a new low.')
    expect(lines[1]).toBe('Most new highs: AAA (12 times, $10.50, +2.50% vs the prior close); BBB (1 time, $1,234.50, +0.75% vs the prior close).')
    expect(lines[2]).toBe('Most new lows: CCC (3 times, $10.50, −4.10% vs the prior close).')
    expect(a.text).toContain(NOT_52_WEEK)
    expect(a.text).toContain("Counts as of the scanner's last reading at 10:29 AM ET (UCT's own polling time, not an exchange timestamp).")
    expect(a.table.rows.map(r => `${r.side} ${r.symbol}`)).toEqual(['New high AAA', 'New high BBB', 'New low CCC'])
    expect(a.present.items.map(i => i.value)).toEqual(['40', '2'])
    expect(a.facts.highs.map(r => r.symbol)).toEqual(hiloPanel.highsLowsBoard(hiloEnv().data).highs.map(r => r.sym))
  })
  it('one side only, when asked', () => {
    const a = answerFromHighsLows(hiloEnv(), hiloPanel, { side: 'lows' })
    expect(a.text).not.toContain('Most new highs')
    expect(a.table.rows.map(r => r.symbol)).toEqual(['CCC'])
  })
  it('a closed market is the last tracked session, and a stopped scanner is stale', () => {
    const c = honest(answerFromHighsLows(hiloEnv({ window: 'closed', active: false }, { freshness: 'historical' }), hiloPanel))
    expect(c.text.split('\n')[0]).toMatch(/^New highs and new lows of the last tracked session \(market closed\), Fri, Nov 13, 2026: /)
    expect(c.text).toContain('The market is closed: these are the counts of the last tracked session, not a reading of an open session.')
    const s = honest(answerFromHighsLows(hiloEnv({}, { stale: true }), hiloPanel))
    expect(s.text).toContain("Stale: the scanner's last reading is more than a minute old, so newer highs and lows may be missing.")
  })
  it('scanner off / refused: no counts, and never "nothing made a new high"', () => {
    const u = honest(answerFromHighsLows(UNAVAILABLE, hiloPanel))
    expect(u.text).toMatch(/^I couldn't read UCT's new highs and lows scanner: it has no counts available .*No figure is stated\.$/)
    expect(u.text).not.toMatch(/\b0 stocks\b/)
    expect(honest(answerFromHighsLows(REFUSED, hiloPanel)).text).toMatch(/that request wasn't allowed/)
  })
})

// ── leaders.longRun → stock.longRunLeaders ─────────────────────────────────────────────────────────────────────────────
const lrow = (i) => ({ sym: `A${i}`, change_nd: 80 - i, ref_close: 10, price: 18 - i, prev_close: 17.5, change_pct: 1.2, volume: 5000000, ref_max: 4000000, ratio: 1.25, ipo_date: 20260212, isolated: true })
const leadersEnv = (list, n = 2, over = {}, envOver = {}) => envelope(KINDS.leaders, {
  list, status: 'ok', results: Array.from({ length: n }, (_, i) => lrow(i)), count: 4, as_of: '2026-11-13T10:29:30-05:00', computed_at: '2026-11-13T15:29:30Z', isolated: true, ...over,
}, { isolated: true, ...envOver })

describe('stock.longRunLeaders — the answer', () => {
  it('gainers: the window\'s move from its reference close, with UCT\'s own working time', () => {
    const a = honest(answerFromLeaders(leadersEnv('30D'), '30D'))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe("UCT's 30-day gainers: 4 names, the first 2 in the list's own order.")
    expect(lines[1]).toBe('• A0 +80.00% over 30 sessions (from a close of $10.00), last $18.00')
    expect(a.text).toContain("Worked out by UCT at 10:29 AM ET from a market snapshot up to 30 seconds older (UCT's own time, not an exchange timestamp).")
    expect(a.table.columns.map(c => c.label)).toEqual(['Symbol', 'Change, 30 sessions', 'From a close of', 'Last', 'Change vs prior close'])
    expect(a.facts).toMatchObject({ list: '30D', kind: 'gain', total: 4, shown: 2 })
  })
  it('volume records and new listings read their own fields', () => {
    const v = honest(answerFromLeaders(leadersEnv('VOLMAX'), 'VOLMAX'))
    expect(v.text.split('\n')[1]).toBe('• A0 5,000,000 shares, 1.25 times its previous record of 4,000,000 (its whole history), last $18.00')
    const i = honest(answerFromLeaders(leadersEnv('IPO'), 'IPO'))
    expect(i.text.split('\n')[1]).toBe('• A0 first traded Feb 12, 2026, last $18.00')
  })
  it('an empty list says both things it can mean; a list still building is not an empty list', () => {
    const e = honest(answerFromLeaders(leadersEnv('60D', 0, { count: 0 }), '60D'))
    expect(e.text.split('\n')[0]).toBe("UCT's list of 60-day gainers is empty. That can mean nothing qualifies, or that the market snapshot it is measured against was missing (before the open, or a feed miss): UCT's data cannot tell which.")
    expect(e.table).toBeUndefined()
    const u = honest(answerFromLeaders(UNAVAILABLE, '60D'))
    expect(u.text).toMatch(/^I couldn't read UCT's list of 60-day gainers: it is not available .*its reference may still be building.*No figure is stated\.$/)
    expect(u.text).not.toMatch(/is empty/)
    expect(answerFromLeaders(leadersEnv('30D'), 'NOPE').text).toMatch(/couldn't tell which long-run list/)
  })
  it('the lists offered are the kind\'s own (read from the adapter, never retyped)', () => {
    const src = py('api/services/uct_agent/marketdata/leaders_long_run.py')
    const block = src.slice(src.indexOf('LISTS: dict['), src.indexOf('NOTE_COMPUTING'))
    expect(block.match(/^ {4}"([A-Z0-9]+)":/gm).map(s => s.trim().slice(1, -2))).toEqual(LONG_RUN_LENS_KEYS)
  })
})

// ── levels.darkpool → stock.darkPoolLevels ─────────────────────────────────────────────────────────────────────────────
const level = (rank, price, lastDate, notional) => ({ price, notional, printCount: 4, lastDate, lo: price - 0.1, hi: price + 0.1, rank, isolated: true })
const dpEnv = (over = {}, envOver = {}) => envelope(KINDS.darkPool, {
  sym: 'AAA', levels: [level(2, 98.5, '2026-11-13', 12500000), level(1, 101.25, '2026-11-10', 25000000)], windowDays: 20, datesCovered: 14, version: 'dpl-v1',
  asOf: 1794583800, computed_at: '2026-11-13T15:30:00Z', newest_print_date: '2026-11-13', isolated: true, ...over,
}, { freshness: 'historical', as_of: '2026-11-13T21:00:00Z', isolated: true, ...envOver })

describe('stock.darkPoolLevels — the answer', () => {
  it('levels highest price first, dated by the newest confirmed print (never the build time)', () => {
    const a = honest(answerFromDarkPool(dpEnv(), 'AAA'))
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('AAA dark pool levels from confirmed prints over the last 20 sessions (14 sessions had prints), highest price first: 2 levels.')
    expect(lines[1]).toBe('• $101.25 — zone $101.15 to $101.35, $25.0M across 4 prints, rank 1 by dollar value, last print Nov 10, 2026')
    expect(lines[2]).toBe('• $98.50 — zone $98.40 to $98.60, $12.5M across 4 prints, rank 2 by dollar value, last print Nov 13, 2026')
    expect(a.text).toContain('As of the newest confirmed print among these levels, Fri, Nov 13, 2026.')
    expect(a.text).toContain('Dark pool prints are confirmed overnight, so nothing from a session still open is included.')
    expect(a.table.rows.map(r => r.price)).toEqual(['$101.25', '$98.50'])
    expect(a.facts).toMatchObject({ symbol: 'AAA', window_days: 20, dates_covered: 14, levels: 2, newest_print: '2026-11-13' })
  })
  it('no cluster is a normal answer; a failed read is never "no levels"', () => {
    const n = honest(answerFromDarkPool(dpEnv({ levels: [], newest_print_date: null }, { as_of: null }), 'AAA'))
    expect(n.text.split('\n')[0]).toBe('AAA has no dark pool level over the last 20 sessions: no cluster of confirmed dark pool prints was large enough. That is a normal answer, not a failed read.')
    const u = honest(answerFromDarkPool(UNAVAILABLE, 'AAA'))
    expect(u.text).toBe("I couldn't read AAA's dark pool levels: they are not available from UCT's data at the moment. No level is stated, and that is not the same as no levels.")
    expect(honest(answerFromDarkPool(dpEnv({ levels: null }), 'AAA')).text).toMatch(/did not answer cleanly\. No level is stated/)
    expect(honest(answerFromDarkPool(REFUSED, 'AAA')).text).toMatch(/that request wasn't allowed/)
  })
})

// ── served vs dark, isolation on both sides, the manifest limits, one read per answer ──────────────────────────────────
let calls, ENVS
function wire(kinds) {
  calls = []; ENVS = {}
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') return json(ENVS[body.kind] || { status: 'refused', data: null, notes: ['refused'] })
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const LOCAL = Object.values(CAPABILITIES)
const ALL = [SECTOR_CAPABILITY, ...LOCAL]
const PAIRS = [[SECTOR_KIND, SECTOR_CAPABILITY], ...Object.keys(KINDS).map(k => [KINDS[k], CAPABILITIES[k]])]
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetTerminalDataForTest(); _resetTerminalLocalForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'cot.positioning'], 'other kinds only']])('dark (%j, %s): none of the five is registered', async (kinds) => {
    const before = allCapabilityNames()
    wire(kinds)
    await loadAgentConfig()
    expect(sectorsServed()).toBe(false)
    expect(registerTerminalDataCapability()).toBe(false)
    expect(registerTerminalLocalCapabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
    expect(allCapabilityNames().filter(n => !before.includes(n) && n.startsWith('stock.') && ALL.includes(n))).toEqual([])
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalDataCapability()).toBe(false)             // idempotent
    expect(registerTerminalLocalCapabilities()).toEqual([])
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all five served: local-only on BOTH sides for the four isolated kinds, a plain data read for the sector answer', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const turnPy = py('api/services/uct_agent/turn.py')
    const dataReads = /^DATA_READ_ACTIONS = frozenset\(\{([\s\S]*?)^\}\)/m.exec(turnPy)[1]
    for (const [kind, name] of PAIRS) {
      const cap = getCapability(name)
      expect(cap, name).toBeTruthy()
      expect(cap.query, name).toBe(true)
      expect(groupOfAction(name), name).toBe('data')                 // routed with the stock data group (by domain)
      expect(cap.summary.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
      expect(cap.hints.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
      const isolated = handshake.isolated_kinds.includes(kind)
      expect(isolated, kind).toBe(name !== SECTOR_CAPABILITY)
      expect(cap.localOnly === true, name).toBe(isolated)
      expect(handshake.local_only_actions.includes(name), name).toBe(isolated)     // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(!isolated)                // turn.DATA_READ_ACTIONS: the two sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[SECTOR_KIND] = sectorEnv()
    ENVS[KINDS.analyst] = analystEnv()
    ENVS[KINDS.highsLows] = hiloEnv()
    ENVS[KINDS.leaders] = leadersEnv('VOL1Y')
    ENVS[KINDS.darkPool] = dpEnv()
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(SECTOR_CAPABILITY, { period: '1M' })).text).toMatch(/^Sector funds ranked by change, 1 month/)
    expect((await run(CAPABILITIES.analyst, { side: 'targets' })).text).toMatch(/^Analyst actions from the morning wire of Fri, Nov 13, 2026/)
    expect((await run(CAPABILITIES.highsLows, { side: null, limit: 500, min_price: 5 })).text).toMatch(/^New highs and new lows of the day/)
    expect((await run(CAPABILITIES.leaders, { list: 'VOL1Y', limit: null })).text).toMatch(/^UCT's 1-year volume highs: 4 names/)
    expect((await run(CAPABILITIES.darkPool, { symbol: '$aaa' })).text).toMatch(/^AAA dark pool levels/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [SECTOR_KIND, { period: '1M' }, 'answer'],
      [KINDS.analyst, { side: 'pt_changes' }, 'answer'],
      [KINDS.highsLows, { limit: 50, min_price: 5 }, 'answer'],
      [KINDS.leaders, { list: 'VOL1Y', limit: 20 }, 'answer'],
      [KINDS.darkPool, { symbol: 'AAA' }, 'answer'],
    ])
  })

  it('no read without a turn or without a usable argument, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect((await getCapability(SECTOR_CAPABILITY).answer(null, { period: null }, null)).text).toMatch(/needs the Agent's turn/)
    expect((await getCapability(CAPABILITIES.darkPool).answer(null, { symbol: 'AAA' }, null)).text).toMatch(/needs the Agent's turn/)
    expect((await inTurn(() => getCapability(CAPABILITIES.darkPool).answer(null, { symbol: 'not a ticker!' }, null))).text).toMatch(/^Which stock's dark pool levels/)
    expect((await inTurn(() => getCapability(CAPABILITIES.leaders).answer(null, { list: 'TOP', limit: null }, null))).text).toMatch(/^Which list should I read/)
    expect(reads()).toEqual([])
    const a = await inTurn(() => getCapability(CAPABILITIES.leaders).answer(null, { list: 'IPO', limit: 5 }, null))   // the stub refuses
    expect(a.text).toMatch(/^I couldn't read UCT's list of new listings: that request wasn't allowed for this question/)
    expect(reads()).toHaveLength(1)
  })
})

// ── routing: each capability's own words, on the data group only while it is registered ────────────────────────────────
const dataGroup = () => GROUPS.find(g => g.id === 'data')
const DATA_BASE = [...dataGroup().words]                 // read before anything is served: routing.js's own list
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const wordKeys = (text) => Object.keys(TERMINAL_ROUTE_WORDS).filter(k => TERMINAL_ROUTE_WORDS[k].some(re => re.test(String(text).toLowerCase())))
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  analyst: ['what got upgraded today', 'any analyst upgrades this morning', 'who got downgraded', 'analyst price target changes', 'which stocks got new coverage', 'show me the analyst calls from the morning wire'],
  highsLows: ['new highs today', 'what is making new highs today', 'stocks hitting new lows of the day', 'which stocks are at session highs', 'new highs and lows this morning'],
  leaders: ['top gainers over 60 days', 'top gainers over the last 3 months', 'biggest gainers in the last 30 sessions', 'best performers over 90 days', 'stocks trading record volume', 'recent IPOs'],
  darkPool: ['dark pool levels on NVDA', 'NVDA dark pool levels', 'show me the dark pool levels for TSLA', 'big dark pool prints in AAPL'],
}
/** another capability's language: none of the four's words may name these */
const NOT_OURS = [
  'upgrade my plan', 'how do i upgrade to pro', 'upgrade my subscription',                                          // the member's own plan
  'how many new highs today', 'new 52-week highs today', 'net new highs today', 'stocks making new highs',           // breadth's measures
  'what % of stocks made new highs today', 'new 20-day lows today',
  'top gainers today', 'show me the leaders', 'recent ipos that are acting well', 'new listings above their 50 day', // the Screener's
  'turn on dark pool', 'show dark pool levels on this chart', 'make the dark pool bars gold',                        // chart.setSetting
  'find stocks with dark pool prints over 10m', 'only dark pool prints in the options flow', 'add a dark pool widget', 'open the dark pool page',
  'switch to weekly', 'add the 50 day moving average', 'any news on TSLA', 'when does NVDA report earnings',
]

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', SECTOR_KIND], 'other kinds only']])('dark (%j, %s): the data group keeps exactly routing.js\'s words', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(dataGroup().words).toEqual(DATA_BASE)
    for (const res of Object.values(TERMINAL_ROUTE_WORDS)) for (const re of res) expect(dataGroup().words).not.toContain(re)
    for (const q of [ASKS.analyst[0], ASKS.darkPool[0]]) expect(wordsSelect('data', q), q).toBe(false)
  })

  it.each(Object.keys(KINDS))('served %s alone: only its own words are added, after routing.js\'s, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(dataGroup().words).toEqual([...DATA_BASE, ...TERMINAL_ROUTE_WORDS[key]])
    registerTerminalLocalCapabilities()                                // idempotent: never armed twice
    expect(dataGroup().words).toHaveLength(DATA_BASE.length + TERMINAL_ROUTE_WORDS[key].length)
    reset()
    expect(dataGroup().words).toEqual(DATA_BASE)
  })

  it('every capability has words, and each ask is named by its own capability\'s words', () => {
    expect(Object.keys(TERMINAL_ROUTE_WORDS).sort()).toEqual(Object.keys(KINDS).sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toContain(key)
  })

  it('served: each ask routes its capability under v1 and v2, and the budget never cuts the data group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const [key, asks] of Object.entries(ASKS)) {
      for (const q of asks) {
        expect(wordsSelect('data', q), q).toBe(true)
        expect(selectGroups(q).selected, q).toContain('data')
        for (const route of [routeManifest, routeManifestV2]) {
          const r = route(full, q, ROUTE_OPTS())
          expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITIES[key])
          expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain('data')
        }
      }
    }
    // the sector answer needs no words of its own: routing.js's `sectors?` already names the data group
    for (const q of ['sector performance this month', 'how have the sector funds performed over the last month']) {
      expect(wordKeys(q), q).toEqual([])
      for (const route of [routeManifest, routeManifestV2]) expect(route(full, q, ROUTE_OPTS()).manifest.map(c => c.name), `${route.name}: ${q}`).toContain(SECTOR_CAPABILITY)
    }
  })

  it('the words never name another capability\'s language', () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
  })

  it('no row of the routing-collision table that another group owns is named by these words', () => {
    // baseline/routingCollisions.json is asserted under production's kinds, where these words are not armed: this holds it armed
    const stolen = collisions.rows.filter(r => r.owner !== 'data' && !(r.also || []).includes('data') && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
