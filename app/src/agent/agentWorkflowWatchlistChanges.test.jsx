// Track D workflow "watchlistChanges" — `watchlist.changes` (DARK, UCT_AGENT_WORKFLOWS). Pure computation over SYNTHETIC
// quote and news envelopes (counts, top movers, the 24-hour news window, floors), the refusals (no quotes, nothing with a
// change, empty list, list longer than one read), the REAL panel (fast path; reads: 1 quotes + news for the largest
// movers only), dark by default, and isolation. No model, no provider, no real market value anywhere.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from './testing/panelHarness'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { groupOfAction, GROUPS } from './routing'
import { _resetTurns } from './trace'
import {
  changesOf, newsCountOf, answerFromChanges, watchlistChangesServed, registerWatchlistChangesCapability, _resetWatchlistChangesForTest,
  CAPABILITY, MAX_SYMBOLS, NEWS_FOR, CHANGE_WORDS,
} from './capabilities/watchlistChanges'
import { DESCRIPTIVE } from './capabilities/workflowGate'

registerBuiltins()

const AS_OF = '2026-11-03T19:30:00Z'          // Tue, Nov 3, 2:30 PM ET (synthetic)
const PCT = { T01: 4.2, T02: -3.1, T03: 0.5, T04: 0, T05: -0.25, T06: 1.75, T07: -6 }
function quotesEnv(pct = PCT, o = {}) {
  const quotes = Object.entries(pct).map(([symbol, p]) => ({ symbol, last: 10, last_source: 'trade', change: p / 10, change_pct: p, prev_close: 10, as_of: AS_OF }))
  return { contract: 'MD-1.0', kind: 'quotes', params_echo: {}, status: 'ok', freshness: 'live', as_of: AS_OF, fetched_at: AS_OF, delay_s: 0, stale: false,
    source: 'massive-snapshot', coverage: null, provider_calls: 1, notes: ['a note that must never be echoed'], data: { quotes, session: 'regular' }, ...o }
}
const hoursBefore = (h) => new Date(Date.parse(AS_OF) - h * 3600e3).toISOString()
function newsEnv(ages, o = {}) {
  return { contract: 'MD-1.0', kind: 'news.company', status: 'ok', freshness: 'periodic', as_of: ages.length ? hoursBefore(Math.min(...ages)) : null, stale: false,
    notes: [], data: { symbol: 'X', items: ages.map((h, i) => ({ headline: `synthetic ${i}`, url: '', source: 's', as_of: hoursBefore(h) })), has_more: false }, ...o }
}

describe('watchlist.changes: the computation and the card (pure)', () => {
  it('counts, top movers each way (by the row\'s own change_pct), largest absolute movers for news', () => {
    const c = changesOf(quotesEnv(), Object.keys(PCT))
    expect(c).toMatchObject({ ok: true, up: 3, down: 3, flat: 1, session: 'regular', asOf: AS_OF })
    expect(c.gainers.map(r => r.symbol)).toEqual(['T01', 'T06', 'T03'])
    expect(c.decliners.map(r => r.symbol)).toEqual(['T07', 'T02', 'T05'])
    expect(c.movers.map(r => r.symbol)).toEqual(['T07', 'T01', 'T02', 'T06', 'T03'])
    expect(c.movers).toHaveLength(NEWS_FOR)
  })

  it('news: only items in the 24 hours to the snapshot count; a full page with more is a floor; stale is said', () => {
    expect(newsCountOf(newsEnv([1, 5, 23.9, 25, 48]), AS_OF)).toEqual({ count: 3, plus: false, stale: false })
    expect(newsCountOf(newsEnv(Array.from({ length: 25 }, (_, i) => i / 2), { data: { items: Array.from({ length: 25 }, (_, i) => ({ as_of: hoursBefore(i / 2) })), has_more: true } }), AS_OF)).toEqual({ count: 25, plus: true, stale: false })
    expect(newsCountOf({ status: 'unavailable', data: null }, AS_OF)).toBeNull()
  })

  it('the card: dated header with session, counts, movers, news window, descriptive; never "live"/"now", never a note', () => {
    const news = { T07: newsEnv([2, 3]), T01: newsEnv([30]), T02: { status: 'unavailable', data: null }, T06: newsEnv([1], { stale: true }), T03: newsEnv([]) }
    const a = answerFromChanges(quotesEnv(), { name: 'Momentum', symbols: Object.keys(PCT), total: 7, news })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe("“Momentum” — change vs each stock's previous session close, from UCT's quote snapshot as of Tue, Nov 3, 2:30 PM ET (regular session):")
    expect(lines[1]).toBe('7 with a price change figure: 3 up, 3 down, 1 unchanged.')
    expect(lines[2]).toBe('Biggest gainers: T01 +4.20%, T06 +1.75%, T03 +0.50%.')
    expect(lines[3]).toBe('Biggest decliners: T07 −6.00%, T02 −3.10%, T05 −0.25%.')
    expect(lines[4]).toBe('Stored news items in the 24 hours to Tue, Nov 3, 2:30 PM ET (largest movers): T07 2, T01 0, T06 1, T03 0.')
    expect(a.text).toContain('News count not available for: T02.')
    expect(a.text).toContain("Note: UCT's news ingest is behind")
    expect(lines.at(-1)).toBe(DESCRIPTIVE)
    expect(a.text).not.toMatch(/never be echoed|synthetic|\blive\b|\bnow\b|\bbuy\b|\bsell\b/i)
    expect(a.table.rows[0]).toEqual(['T01', '4.20'])
    expect(a.changes).toMatchObject({ list: 'Momentum', up: 3, down: 3, flat: 1, asOf: AS_OF })
  })

  it('refusals and partial answers: no quotes / nothing with a change → fixed words, no figure; missing rows and a long list are named', () => {
    const t1 = answerFromChanges({ status: 'unavailable', data: null }, { name: 'Momentum', symbols: ['T01'] }).text
    expect(t1).toBe("I couldn't say what changed in “Momentum”: its quotes are not available from UCT's market data. No figure is stated.")
    const t2 = answerFromChanges(quotesEnv({ T01: null }), { name: 'Momentum', symbols: ['T01'] }).text
    expect(t2).toBe("I couldn't say what changed in “Momentum”: no symbol in it came back with a price change. No figure is stated.")
    const part = answerFromChanges(quotesEnv({ T01: 1, T02: null }, { status: 'partial', stale: true }), { name: 'Big', symbols: ['T01', 'T02', 'T09'], total: 80 }).text
    expect(part).toContain('No quote for: T09.')
    expect(part).toContain('No change figure for: T02.')
    expect(part).toContain('Only the first 3 of the list\'s 80 symbols were read')
    expect(part).toContain("Note: some quotes are older than UCT's freshness window")
  })
})

// ── the REAL panel ──────────────────────────────────────────────────────────────────────────────────────────────
const SERVED = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['quotes', 'news.company', 'instrument.resolve'], workflows: ['watchlistChanges'] }
const LISTS = [{ id: 'w1', name: 'Momentum', symbols: Object.keys(PCT) }, { id: 'w2', name: 'Earnings', symbols: ['T01'] }, { id: 'w3', name: 'Empty', symbols: [] },
  { id: 'w4', name: 'Huge', symbols: Array.from({ length: 60 }, (_, i) => `H${String(i).padStart(2, '0')}`) }]
let p, reads, config
function wirePanel() {
  reads = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json(config)
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); reads.push(b)
      if (b.kind === 'quotes') return json(quotesEnv(Object.fromEntries(b.params.symbols.map(s => [s, PCT[s] ?? 1]))))
      if (b.kind === 'news.company') return json(newsEnv([1, 2]))
      return json({ status: 'refused', data: null })
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return harness(url, init)
  })
}

describe('watchlist.changes: served panel, dark, isolation', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetWatchlistChangesForTest(); config = SERVED; wirePanel() })
  afterEach(() => { _resetTurns(); _resetWatchlistChangesForTest(); vi.restoreAllMocks() })

  it('fast path: 0 model turns; ONE quotes read of the list, then news for the 5 largest movers only; nothing changed', async () => {
    const { say, h } = p.mount(...ONE('QQQ'), { watchlists: LISTS })
    const before = h.charts.list().map(c => c.symbol)
    const out = await say('what changed in my Momentum watchlist since yesterday?')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => r.kind)).toEqual(['quotes', ...Array(NEWS_FOR).fill('news.company')])
    expect(reads[0]).toMatchObject({ params: { symbols: Object.keys(PCT) }, purpose: 'answer' })
    expect(reads.slice(1).map(r => r.params)).toEqual(['T07', 'T01', 'T02', 'T06', 'T03'].map(symbol => ({ symbol, limit: 25 })))
    expect(reads.every(r => typeof r.turn_id === 'string')).toBe(true)
    expect(out).toContain('“Momentum” — change vs each stock\'s previous session close')
    expect(out).toContain(DESCRIPTIVE)
    expect(h.charts.list().map(c => c.symbol)).toEqual(before)
  })

  it('a list longer than one quote read: the first 50 are read and the card says so; an empty list reads nothing', async () => {
    const { say } = p.mount(...ONE('QQQ'), { watchlists: LISTS })
    const out = await say('how is my Huge watchlist doing today')
    expect(reads[0].params.symbols).toHaveLength(MAX_SYMBOLS)
    expect(out).toContain('Only the first 50 of the list\'s 60 symbols were read')
    const n = reads.length
    const empty = await say('movers in my Empty watchlist')
    expect(empty).toContain('“Empty” is empty, so nothing changed in it.')
    expect(reads).toHaveLength(n)
  })

  it('model path (scripted) on an unnamed list: the planned target is used; "my watchlist" with several lists is not guessed by the fast path', async () => {
    const { say } = p.mount(...ONE('QQQ'), { watchlists: LISTS })
    p.st.envelopes.push(p.env('apply', [{ action: CAPABILITY, target: 'w3', args: {} }], ''))   // (context refs: w1 = the workspace, then the lists in order)
    const out = await say('what changed in my watchlist')
    expect(p.turns()).toBe(1)
    expect(JSON.stringify(p.lastTurnBody())).toContain(CAPABILITY)
    expect(reads[0].params.symbols).toEqual(['T01'])
    expect(out).toContain('“Earnings” — change vs')
  })

  it('dark by default: flag off, or a kind missing → nothing registers, no routing words, no read', async () => {
    for (const c of [{ workflows: [] }, { workflows: ['relativeStrength'] }, { data: false }, { data_kinds: ['quotes'] }]) {
      _resetAgentConfig(); _resetWatchlistChangesForTest()
      config = { ...SERVED, ...c }
      await loadAgentConfig()
      expect(watchlistChangesServed()).toBe(false)
      expect(registerWatchlistChangesCapability()).toBe(false)
      expect(allCapabilityNames()).not.toContain(CAPABILITY)
    }
    expect(GROUPS.find(g => g.id === 'lists').words).not.toContain(CHANGE_WORDS[0])          // routing exactly as before
    expect(reads).toEqual([])
  })

  it('review #788 f: a LATER config load that switches the workflow off takes the capability and its routing words out', async () => {
    await loadAgentConfig()
    expect(registerWatchlistChangesCapability()).toBe(true)
    _resetAgentConfig(); config = { ...SERVED, workflows: [] }
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(GROUPS.find(g => g.id === 'lists').words).not.toContain(CHANGE_WORDS[0])
  })

  it('isolation and shape: a served NON-local query on the watchlist target in the lists group', async () => {
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const cap = getCapability(CAPABILITY)
    expect(cap).toMatchObject({ query: true, target: 'watchlist' })
    expect(cap.localOnly).toBeFalsy()
    expect(handshake.local_only_actions).not.toContain(CAPABILITY)
    expect(handshake.isolated_kinds).not.toContain('quotes')
    expect(handshake.isolated_kinds).not.toContain('news.company')
    expect(groupOfAction(CAPABILITY)).toBe('lists')
    expect(GROUPS.find(g => g.id === 'lists').words).toContain(CHANGE_WORDS[0])              // its own words, only while registered
  })
})
