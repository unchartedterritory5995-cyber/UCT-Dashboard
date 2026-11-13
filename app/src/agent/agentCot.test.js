// Phase 2 COT research — cot.positioning: the facts (cotRead's math over date-matched rows), the member's answer (report
// date, publish delay, stale, not-covered roster, grounding: every number in the text is a fact's), served vs dark, and
// routing (a COT ask routes to the cot group under v1 and v2; non-COT asks do not; a dark server routes as before).
// No model, no provider: /api/agent/config and /api/agent/data are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, routeManifest, selectGroups } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { cotIndex, percentileRank } from '../pages/cot/cotRead'
import {
  CAPABILITY, KIND, marketFacts, answerFromCot, registerCotCapability, _resetCotForTest, cotServed, weeksFor, COT_ROUTE_WORDS, dayText,
} from './capabilities/cot'

registerBuiltins()

// ── fixtures: weekly rows ending Tue 2026-11-10 (shapes only — synthetic values, never market data) ──
const LAST = '2026-11-10'
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
function rows(n, { last = LAST, skip = [], f = (k) => k } = {}) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    if (skip.includes(i)) continue
    const k = n - i
    out.push({ date: addDays(last, -7 * i), large_spec_net: f(k) * 10, commercial_net: -f(k) * 7, small_spec_net: k - 50, open_interest: 10000 + k })
  }
  return out
}
const series = (symbol, name, rs, extra = {}) => ({ symbol, name, first_date: rs[0].date, report_date: rs.at(-1).date, weeks: rs.length, missing_weeks: 0, stale: false, rows: rs, ...extra })
const envelope = (data, over = {}) => ({
  contract: 'MD-1.0', kind: KIND, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: `${data.report_date || LAST}T00:00:00Z`,
  fetched_at: '2026-11-13T23:00:00Z', delay_s: 259200, stale: false, source: 'cftc-cot', coverage: null,
  notes: ['a provider note that must never be echoed'], provider_calls: 0,
  data: { not_covered: [], no_history: [], covered: null, report_date: LAST, expected_report_date: LAST, delay_days: 3, ...data }, ...over,
})

/** every number token in `text` must be a number in `facts` (as formatted) or part of a date in facts / dayText */
function ungrounded(text, facts) {
  const nums = new Set()
  const dates = new Set()
  const walk = (v) => {
    if (typeof v === 'number') { nums.add(Math.abs(v)); return }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { dates.add(dayText(v)); return }
    if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(facts)
  let t = text
  for (const d of dates) t = t.split(d).join(' ')
  return (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, ''))).filter(x => !nums.has(x))
}

describe('marketFacts — cotRead math over date-matched rows', () => {
  it('WoW, N-week change, range, percentile, index, high / low', () => {
    const rs = rows(200)
    const f = marketFacts(series('GC', 'Gold', rs), { years: 3, changeWeeks: 4 })
    const g = f.groups.large_specs
    expect(g.net).toBe(2000)
    expect(g.wow).toBe(10)
    expect(g.change).toEqual({ weeks: 4, value: 40 })
    expect(f.lookback).toEqual({ years: 3, weeks: 156, from: addDays(LAST, -7 * 155), short: false })
    expect(g.high).toEqual({ value: 2000, date: LAST })
    expect(g.at_high).toBe(true)
    expect(g.at_low).toBe(false)
    const win = rs.slice(-156).map(r => r.large_spec_net)
    expect(g.percentile).toBe(Math.round(percentileRank(win, 2000)))
    expect(g.percentile).toBe(100)
    expect(g.index).toBe(Math.round(cotIndex(win)))
    expect(f.groups.commercials.at_low).toBe(true)
    expect(f.groups.commercials.wow).toBe(-7)
    expect(g.index_3y).toBe(100)
    expect(g.zone_3y).toBe('extreme-long')
  })
  it('a mid-range reading: the percentile of the current net within the lookback', () => {
    // values rise then fall: the last value sits in the middle of the window
    const rs = rows(104, { f: (k) => (k <= 70 ? k : 140 - k) })
    const f = marketFacts(series('CL', 'Crude', rs), { years: 2 })
    const g = f.groups.large_specs
    expect(g.at_high || g.at_low).toBe(false)
    expect(g.percentile).toBe(Math.round(percentileRank(rs.map(r => r.large_spec_net), rs.at(-1).large_spec_net)))
    expect(g.percentile).toBeGreaterThan(0)
    expect(g.percentile).toBeLessThan(50)
    expect(g.change).toBe(null)
  })
  it('a missing week is never bridged: WoW and the N-week change across it are null', () => {
    const f = marketFacts(series('ZN', '10-Year T-Note', rows(60, { skip: [1, 4] }), { missing_weeks: 2 }), { years: 1, changeWeeks: 4 })
    expect(f.wow_missing).toBe(true)
    expect(f.groups.large_specs.wow).toBe(null)
    expect(f.change_missing).toBe(true)
    expect(f.groups.large_specs.change).toEqual({ weeks: 4, value: null })
    expect(f.missing_weeks).toBe(2)
  })
  it('a short history says so (fewer weeks than the lookback)', () => {
    const f = marketFacts(series('BTC', 'Bitcoin', rows(80)), { years: 5 })
    expect(f.lookback.short).toBe(true)
    expect(f.lookback.weeks).toBe(80)
  })
  it('weeksFor: the read covers the lookback, the 3-year index window and the change, within 520', () => {
    expect(weeksFor(3, null)).toBe(156 + 6 + 1)
    expect(weeksFor(10, 52)).toBe(520)
    expect(weeksFor(1, 13)).toBe(156 + 13 + 1)
  })
})

describe('answerFromCot — report date, delay, stale, not covered, grounded', () => {
  it('one market: the report date, the Tuesday/Friday delay, the limits; every number is a fact', () => {
    const a = answerFromCot(envelope({ series: [series('GC', 'Gold', rows(200))] }), { years: 3, changeWeeks: 4 })
    expect(a.text).toMatch(/^COT positioning — Gold \(GC\): CFTC report of Nov 10, 2026 \(positions as of that Tuesday, published by CFTC the following Friday, about 3 days later\)\./)
    expect(a.text).toMatch(/• Large speculators: net long 2,000 contracts \(\d+(\.\d)?% of open interest\); week over week \+10; 4-week change \+40; 3-year range \+[\d,]+ \([A-Z][a-z]{2} \d{1,2}, \d{4}\) to \+2,000 \(Nov 10, 2026\) — at its 3-year high; 100th percentile of that history; 3-year COT Index 100 \(extreme long\)\./)
    expect(a.text).toMatch(/Weekly data only/)
    expect(a.text).toMatch(/about ten years/)
    expect(a.text).not.toMatch(/never be echoed|Stale/)
    expect(a.link.href).toBe('/breadth?tab=cot&cot=GC')
    expect(a.facts.report_date).toBe(LAST)
    expect(ungrounded(a.text, { ...a.facts, years: [3, 10, 4] })).toEqual([])
  })
  it('stale: said with the expected report date and which market is behind', () => {
    const late = rows(30, { last: '2026-10-27' })
    const a = answerFromCot(envelope({ series: [series('GC', 'Gold', late, { stale: true })], report_date: '2026-10-27', expected_report_date: LAST }, { stale: true }))
    expect(a.text).toMatch(/Stale: the newest report here is Oct 27, 2026, but CFTC's report of Nov 10, 2026 should already be out \(behind: GC\), so this is not the latest week\./)
    expect(a.facts.stale).toBe(true)
  })
  it('a comparison: one table row per market, the lagging market named, the focus group in the columns', () => {
    const a = answerFromCot(envelope({ series: [series('GC', 'Gold', rows(200)), series('SI', 'Silver', rows(200, { f: (k) => -k }))] }), { group: 'large_specs', years: 3, changeWeeks: 13 })
    expect(a.table.columns.map(c => c.label)).toEqual(['Market', 'Report', 'Large speculators net', 'WoW', '13-wk chg', '%ile (3y)', 'COT Index (3y)'])
    expect(a.table.rows.map(r => r.market)).toEqual(['Gold (GC)', 'Silver (SI)'])
    expect(a.table.rows[1].pctile).toBe('0')
    expect(a.text).toMatch(/Silver \(SI\), report of Nov 10, 2026:\n• Large speculators: net short 2,000 contracts/)
    expect(a.text).not.toMatch(/Commercials:/)              // one group asked for
    expect(ungrounded(a.text, { ...a.facts, years: [3, 10, 13] })).toEqual([])
  })
  it('an unmapped market: honest "not covered" with the covered roster, no figure', () => {
    const covered = [{ symbol: 'GC', name: 'Gold', group: 'Metals' }, { symbol: 'CL', name: 'Crude Oil (WTI)', group: 'Energies' }]
    const a = answerFromCot(envelope({ series: [], not_covered: ['lithium'], covered }, { status: 'partial', as_of: null }))
    expect(a.text).toMatch(/^UCT's COT data doesn't cover lithium, so no positioning figure is stated\.\nCovered markets: Gold \(GC\), Crude Oil \(WTI\) \(CL\)\./)
    expect(a.facts.markets).toEqual([])
  })
  it('a partial (one covered, one not): the covered market is answered and the other is named', () => {
    const a = answerFromCot(envelope({ series: [series('GC', 'Gold', rows(60))], not_covered: ['tesla'], covered: [{ symbol: 'GC', name: 'Gold' }] }, { status: 'partial' }), { years: 1 })
    expect(a.text).toMatch(/Not covered by UCT's COT data: tesla\./)
    expect(a.text).toMatch(/Large speculators: net long/)
  })
  it('refused / unavailable: one fixed line, no figure', () => {
    expect(answerFromCot({ status: 'refused', data: null }).text).toBe("I couldn't read UCT's COT data: that request wasn't allowed for this question, so no COT data was read. No figure is stated.")
    expect(answerFromCot(null).text).toMatch(/could not answer it right now\. No figure is stated\.$/)
  })
})

// ── served vs dark, routing, and the end-to-end ask ──
let KINDS, calls, ENV
function wire(kinds) {
  KINDS = kinds; calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    calls.push([u, init?.body ? JSON.parse(init.body) : null])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: KINDS !== null, scan: false, data_kinds: KINDS || [] })
    if (u === '/api/agent/data') return json(ENV)
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const cotGroup = () => GROUPS.find(g => g.id === 'cot')

const COT_ASKS = [
  'Where are large speculators positioned in gold?',
  'What is the COT data for crude oil?',
  'how did commercials change their net position in the 10-year over the last 4 weeks',
  'Are specs net long the euro at a 3-year extreme?',
  'compare large spec positioning in gold and silver',
  'show me the commitments of traders for the S&P',
  'is open interest in crude at a five year high',
]
const NOT_COT = [
  'What is the gold price?', 'Put GLD on the chart', 'add the 50 day moving average', 'show me the news on NVDA',
  'how is US breadth now?', 'what is the open interest on NVDA calls', 'Find stocks near new highs', 'switch to the weekly',
  'what does a commercial real estate REIT do', 'tell me about the S&P 500 ETF',
]

describe('served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetCotForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetTurns(); _resetCotForTest() })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes'], 'other kinds only']])('dark (%j, %s): not registered, the group has no words, routing unchanged', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(cotServed()).toBe(false)
    expect(registerCotCapability()).toBe(false)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(cotGroup().words).toEqual([])
    const full = manifestFor({ surface: 'charts', createIndicator: true })
    for (const q of COT_ASKS) expect(selectGroups(q).selected).not.toContain('cot')
    expect(routeManifest(full, COT_ASKS[0], OPTS()).manifest.some(c => c.name === CAPABILITY)).toBe(false)
  })

  it('served: registers once, arms the group words, and unregisters cleanly', async () => {
    wire([KIND])
    await loadAgentConfig()
    expect(cotServed()).toBe(true)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).toContain(CAPABILITY)
    expect(registerCotCapability()).toBe(false)               // idempotent
    expect(cotGroup().words).toEqual(COT_ROUTE_WORDS)
    expect(cotGroup().wordsOnly && cotGroup().fillLast).toBe(true)
    _resetCotForTest()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(cotGroup().words).toEqual([])
  })

  it('routing (served): every COT ask routes the cot group under v1 and v2; non-COT asks do not', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of COT_ASKS) {
      expect(selectGroups(q).selected, q).toContain('cot')
      for (const route of [routeManifest, routeManifestV2]) {
        const r = route(full, q, OPTS())
        expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITY)
        expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain('cot')
      }
    }
    for (const q of NOT_COT) {
      expect(selectGroups(q).selected, q).not.toContain('cot')
      const r = routeManifestV2(full, q, OPTS())
      expect(r.manifest.map(c => c.name), `v2: ${q}`).not.toContain(CAPABILITY)
    }
  })

  it('end to end: a natural-language ask routes to cot.positioning, makes ONE read, and the answer carries the report date and the delay', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENV = envelope({ series: [series('GC', 'Gold', rows(200))] })
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    const routed = routeManifest(full, 'Where are large speculators positioned in gold versus 3 years of history?', OPTS())
    expect(routed.routing.selected).toContain('cot')
    const cap = routed.manifest.find(c => c.name === CAPABILITY)
    expect(cap.query).toBe(true)
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, { markets: ['gold'], group: 'large_specs', change_weeks: null, lookback_years: 3 }))
    expect(a.text).toMatch(/CFTC report of Nov 10, 2026 \(positions as of that Tuesday, published by CFTC the following Friday/)
    expect(a.text).toMatch(/Large speculators: net long 2,000 contracts/)
    const r = reads()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: KIND, purpose: 'answer', params: { symbols: ['gold'], weeks: 163 } })
    expect(r[0].turn_id).toMatch(/^t-/)
  })

  it('served but no open turn, or no market named: a plain sentence and no read', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect((await getCapability(CAPABILITY).answer(null, { markets: ['gold'], group: null, change_weeks: null, lookback_years: null })).text)
      .toBe("I couldn't read UCT's COT data: this needs the Agent's turn, which wasn't available.")
    expect((await inTurn(() => getCapability(CAPABILITY).answer(null, { markets: [], group: null, change_weeks: null, lookback_years: null }))).text).toMatch(/No figure is stated\.$/)
    expect(reads()).toEqual([])
  })
})
