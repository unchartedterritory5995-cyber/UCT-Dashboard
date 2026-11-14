// Phase 2 market-moving news + catalysts — news.movers over the `catalysts.board` kind: the member's answer (board date,
// updated time, stale, today-missing, absent vs unreadable, not-on-board, the co-occurring-not-causal line, headlines
// quoted exactly as stored, the engine write-up labelled), GROUNDING (every number / time / quoted string in the text is a
// fact's), served vs dark, local-only, the watchlist / date args, the one extra news.company read, the typo lexicon (the
// capability's words cause no new correction on the capreg corpus), and routing (catalyst asks route the catalysts group
// under v1 and v2; non-catalyst asks do not; a dark server routes as before).
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, routeManifest, selectGroups } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { allPhrasings } from './qa/capabilityRegression/testing/corpus'
import handshake from './__fixtures__/program/isolation.json'
import {
  CAPABILITY, KIND, answerFromBoard, rowFacts, registerCatalystsCapability, _resetCatalystsForTest, catalystsServed,
  CATALYST_ROUTE_WORDS, COOCCUR, SOURCE_LINE, dayText,
} from './capabilities/catalysts'

registerBuiltins()

const DAY = '2026-11-13'
const FETCHED = '2026-11-13T15:00:00Z'               // 10:00 AM ET
const row = (symbol, o = {}) => ({
  symbol, market_date: o.date ?? DAY, rank: o.rank ?? 1, catalyst_type: o.type ?? 'Earnings', tag: o.tag ?? 'Catalyst', grade: o.grade ?? 'A',
  gap_pct: o.gap ?? 4.25, sector: o.sector ?? 'Technology', is_new: o.isNew ?? true, pre_move: !!o.pre,
  catalyst_at: o.at ?? '2026-11-13T12:05:00Z', refreshed_at: '2026-11-13T14:15:00Z', as_of: o.at ?? '2026-11-13T12:05:00Z',
  writeup: o.writeup ?? `${symbol} synthetic engine summary`, writeup_at: '2026-11-13T12:30:00Z', writeup_status: 'ok', writeup_sources: ['a.example'],
  headlines: o.headlines ?? [{ title: `${symbol} synthetic headline 7`, source: 'Wire A', url: 'https://a.example/1', published_at: '2026-11-13T12:05:00Z', isolated: true }],
  headline_count: o.hc ?? 1, headlines_redacted: !!o.redacted, social_posts: 2, isolated: true,
})
const envelope = (data, over = {}) => ({
  contract: 'MD-1.0', kind: KIND, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2026-11-13T14:15:00Z',
  fetched_at: FETCHED, delay_s: null, stale: false, source: 'uct-catalyst-engine', coverage: null, isolated: true,
  notes: ['a provider note that must never be echoed'], provider_calls: 0,
  data: { state: 'ok', requested_date: DAY, requested_missing: false, today: DAY, dates: [DAY],
    boards: [{ market_date: DAY, flagged: 2, refreshed_at: '2026-11-13T14:15:00Z' }], rows: [row('AAA'), row('BBB', { rank: 2, gap: -3.04 })],
    sector: null, sectors: ['Technology'], not_on_board: [], ...data }, ...over,
})

/** every number token in `text` must be a number in `facts`, or inside a digit-bearing string of one (a time, a day, a quote) */
function ungrounded(text, facts) {
  const nums = new Set(); const strs = new Set()
  const walk = (v) => {
    if (typeof v === 'number') { nums.add(Math.abs(v)); return }
    if (typeof v === 'string') { if (/\d/.test(v)) strs.add(v); return }
    if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(facts)
  let t = text
  for (const s of [...strs].sort((a, b) => b.length - a.length)) t = t.split(s).join(' ')
  return (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, ''))).filter(x => !nums.has(x))
}
/** every “quoted” string in the text is verbatim in the facts */
function unquoted(text, facts) {
  const blob = JSON.stringify(facts)
  return [...text.matchAll(/“([^”]+)”/g)].map(m => m[1]).filter(q => !blob.includes(JSON.stringify(q).slice(1, -1)))
}

describe('answerFromBoard — the board, honest and grounded', () => {
  it('today\'s board: date, updated time, per-row type / grade / gap / first news, the stored headline, the co-occurrence line, the source', () => {
    const a = answerFromBoard(envelope({}))
    expect(a.text).toMatch(/^UCT's catalyst board, Fri, Nov 13, 2026 \(board updated 9:15 AM ET\): 2 stocks flagged by UCT's catalyst engine\./)
    expect(a.text).toMatch(/• AAA — Earnings · Catalyst · grade A · gap \+4\.3% · new on the board; catalyst news first seen 7:05 AM ET\.\n {3}Headline: “AAA synthetic headline 7” — Wire A, 7:05 AM ET/)
    expect(a.text).toMatch(/• BBB — .*gap −3\.0%/)
    expect(a.text).toMatch(/Engine write-up \(AI-generated 7:30 AM ET, not verified\): “AAA synthetic engine summary”/)
    expect(a.text).toContain(COOCCUR)
    expect(a.text).toContain(SOURCE_LINE)
    expect(a.text).not.toMatch(/never be echoed|Stale|caused by|because of|due to/)
    expect(a.table.rows.map(r => r.symbol)).toEqual(['AAA', 'BBB'])
    expect(ungrounded(a.text, a.facts)).toEqual([])
    expect(unquoted(a.text, a.facts)).toEqual([])
  })
  it('more than 3 rows: one headline each and no write-ups in the text (the table carries the rest)', () => {
    const rows = ['A1', 'B2', 'C3', 'D4'].map((s, i) => row(s.replace(/\d/, 'X'), { rank: i + 1 }))
    const a = answerFromBoard(envelope({ rows, boards: [{ market_date: DAY, flagged: 9, refreshed_at: '2026-11-13T14:15:00Z' }] }))
    expect(a.text).toMatch(/9 stocks flagged by UCT's catalyst engine; the top 4 by the board's rank below\./)
    expect(a.text).not.toMatch(/Engine write-up/)
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('symbols: only those, the rest "not on the board" — never "no news"', () => {
    const a = answerFromBoard(envelope({ rows: [row('AAA')], not_on_board: ['ZZZ'] }), { symbols: ['AAA', 'ZZZ'] })
    expect(a.text).toMatch(/^UCT's catalyst board, Fri, Nov 13, 2026 \(board updated 9:15 AM ET\): 1 stock from AAA and ZZZ was flagged by UCT's catalyst engine\./)
    expect(a.text).toMatch(/Not on the board: ZZZ\. The engine flags a short list of stocks each day, so this is not a sign it had no news\./)
  })
  it('"why is X up" with X not on the board: the news feed\'s stored headlines, co-occurring only, never a cause', () => {
    const news = { status: 'ok', stale: false, data: { items: [{ headline: 'ZZZ synthetic story 1', source: 'Wire C', as_of: '2026-11-13T13:00:00Z' }] } }
    const a = answerFromBoard(envelope({ rows: [], not_on_board: ['ZZZ'] }), { symbols: ['ZZZ'], newsEnv: news })
    expect(a.text).toMatch(/nothing from ZZZ was flagged by UCT's catalyst engine\./)
    expect(a.text).toMatch(/The newest headlines UCT's news feed stored for ZZZ \(co-occurring only, not an established cause\):\n {3}Headline: “ZZZ synthetic story 1” — Wire C, 8:00 AM ET/)
    expect(a.text).toContain(COOCCUR)
    expect(ungrounded(a.text, a.facts)).toEqual([])
    expect(unquoted(a.text, a.facts)).toEqual([])
  })
  it('a multi-day window names each row\'s board day', () => {
    const a = answerFromBoard(envelope({ dates: [DAY, '2026-11-12'], boards: [{ market_date: DAY, flagged: 1, refreshed_at: '2026-11-13T14:15:00Z' }, { market_date: '2026-11-12', flagged: 1, refreshed_at: null }],
      rows: [row('AAA'), row('AAA', { date: '2026-11-12', isNew: false })], not_on_board: [] }), { symbols: ['AAA'] })
    expect(a.text).toMatch(/the last 2 stored boards \(Thu, Nov 12, 2026 to Fri, Nov 13, 2026\)/)
    expect(a.text).toMatch(/• AAA \(Thu, Nov 12, 2026\) — .*continuing from an earlier board/)
    expect(a.table.columns[0].label).toBe('Board')
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('stale: said with the updated time; today missing: said, and the newest stored board named', () => {
    expect(answerFromBoard(envelope({}, { stale: true })).text).toMatch(/Stale: the board was last updated 9:15 AM ET, over 2 hours ago, so newer catalysts may be missing\./)
    const miss = answerFromBoard(envelope({ requested_missing: true, dates: ['2026-11-12'], boards: [{ market_date: '2026-11-12', flagged: 2, refreshed_at: '2026-11-12T20:00:00Z' }] }, { stale: true }))
    expect(miss.text).toMatch(/^There is no stored catalyst board for Fri, Nov 13, 2026; the newest stored board is Thu, Nov 12, 2026\./)
    expect(miss.text).toMatch(/Stale: today's board should already be stored and isn't/)
    expect(miss.text).toMatch(/board updated Thu, Nov 12, 3:00 PM ET/)
  })
  it('redacted headline text is said, never rebuilt; a sector with no match lists the board\'s sectors', () => {
    const a = answerFromBoard(envelope({ rows: [row('AAA', { headlines: [], redacted: true, hc: 2 })] }))
    expect(a.text).toMatch(/Headline text for this older board is no longer stored\./)
    const s = answerFromBoard(envelope({ rows: [], sector: 'semis', sectors: ['Healthcare', 'Technology'] }), { sector: 'semis' })
    expect(s.text).toMatch(/nothing from the semis sector was flagged.*\nNo stock on the board is in a stored sector named “semis”\. Sectors on the board: Healthcare, Technology\./s)
    expect(s.text).not.toContain(COOCCUR)
  })
  it('absent, no board, refused, unavailable: one plain line, no catalyst', () => {
    expect(answerFromBoard(envelope({ state: 'absent', rows: [], dates: [] }, { as_of: null })).text).toMatch(/isn't stored on this server.*No catalyst is stated\.$/)
    expect(answerFromBoard(envelope({ rows: [], dates: [], boards: [] }, { as_of: null })).text).toBe('UCT has no stored catalyst board for Fri, Nov 13, 2026. No catalyst is stated.')
    expect(answerFromBoard({ status: 'refused', data: null }).text).toBe("I couldn't read UCT's catalyst board: that request wasn't allowed for this question, so the board wasn't read. No catalyst is stated.")
    expect(answerFromBoard(null).text).toMatch(/could not be read right now\. No catalyst is stated\.$/)
  })
  it('rowFacts: the gap rounded half away from zero, the tag only when it adds to the type', () => {
    expect(rowFacts(row('A', { gap: -2.25 }), FETCHED).gap).toBe('−2.3%')
    expect(rowFacts(row('A', { type: 'M&A', tag: 'M&A' }), FETCHED).tag).toBe(null)
    expect(dayText('2026-11-13')).toBe('Fri, Nov 13, 2026')
  })
})

// ── served vs dark, routing, the args, and the end-to-end ask ──
let KINDS, calls, ENVS
function wire(kinds) {
  KINDS = kinds; calls = []; ENVS = {}
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: KINDS !== null, scan: false, data_kinds: KINDS || [] })
    if (u === '/api/agent/data') return json(ENVS[body.kind] || { status: 'refused', data: null })
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const group = () => GROUPS.find(g => g.id === 'catalysts')
const ARGS = (o = {}) => ({ symbols: null, watchlist: null, sector: null, date: null, days: null, ...o })

const ASKS = [
  "What's moving the market today?",
  'what is driving stocks this morning',
  'why is NVDA up today',
  'Why is tsla down?',
  'any catalysts for my watchlist this week',
  'show me the catalyst board',
  'what news hit semis today',
  "what are today's catalysts",
  'why are the gappers moving',
]
const NOT_CATALYSTS = [
  'show me the latest NVDA news', 'what are the recent catalysts for AMD?', 'add a news widget', 'move the chart to the right',
  'move NVDA to the top of my watchlist', 'find stocks gapping up 5% on volume', 'when does nvda report', 'show the top gainers',
  'how is US breadth now?', 'switch to the weekly', 'put AAPL on the chart', 'what does NVDA do',
]

describe('served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetCatalystsForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetTurns(); _resetCatalystsForTest() })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'news.company'], 'other kinds only']])('dark (%j, %s): not registered, the group has no words, routing unchanged', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(catalystsServed()).toBe(false)
    expect(registerCatalystsCapability()).toBe(false)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(group().words).toEqual([])
    const full = manifestFor({ surface: 'charts', createIndicator: true })
    for (const q of ASKS) expect(selectGroups(q).selected).not.toContain('catalysts')
    expect(routeManifest(full, ASKS[0], OPTS()).manifest.some(c => c.name === CAPABILITY)).toBe(false)
  })

  it('served: registers once, local-only on both sides, arms the group words, and unregisters cleanly', async () => {
    wire([KIND])
    await loadAgentConfig()
    expect(catalystsServed()).toBe(true)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).toContain(CAPABILITY)
    const cap = getCapability(CAPABILITY)
    expect(cap.localOnly).toBe(true)
    expect(handshake.local_only_actions).toContain(CAPABILITY)       // turn.LOCAL_ONLY_ACTIONS (tests/test_uct_agent_qa_isolation.py)
    expect(handshake.isolated_kinds).toContain(KIND)
    expect(cap.summary.length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
    expect(cap.hints.length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
    expect(registerCatalystsCapability()).toBe(false)                // idempotent
    expect(group().words).toEqual(CATALYST_ROUTE_WORDS)
    expect(group().wordsOnly && group().fillLast).toBe(true)
    _resetCatalystsForTest()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(group().words).toEqual([])
  })

  it('the typo lexicon: registering the capability adds no new correction to any capreg corpus phrasing', async () => {
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().map(p => p.ph.text)), ...ASKS, ...NOT_CATALYSTS, 'sort ascending by change', 'ascending order']
    const read = () => { const lex = lexiconFor(null); return texts.map(t => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))) }
    const before = read()
    _resetAgentConfig(); wire([KIND]); await loadAgentConfig(); registerServerGatedBuiltins()
    expect(allCapabilityNames()).toContain(CAPABILITY)
    const after = read()
    const changed = texts.filter((t, i) => before[i] !== after[i])
    expect(texts.length).toBeGreaterThan(500)
    expect(changed).toEqual([])
  })

  it('routing (served): every catalyst ask routes the catalysts group under v1 and v2; non-catalyst asks do not', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ASKS) {
      expect(selectGroups(q).selected, q).toContain('catalysts')
      for (const route of [routeManifest, routeManifestV2]) {
        const r = route(full, q, OPTS())
        expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITY)
        expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain('catalysts')
      }
    }
    for (const q of NOT_CATALYSTS) {
      expect(selectGroups(q).selected, q).not.toContain('catalysts')
      const r = routeManifestV2(full, q, OPTS())
      expect(r.manifest.map(c => c.name), `v2: ${q}`).not.toContain(CAPABILITY)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only catalysts group', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'show me the leaders', 'both', 'hmm']) {
      for (const route of [routeManifest, routeManifestV2]) {
        expect(route(full, q, OPTS()).manifest.map(c => c.name), `${route.name}: ${q}`).not.toContain(CAPABILITY)
      }
    }
  })

  it('end to end: "what\'s moving the market today" makes ONE read with no filter and answers from the board', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KIND] = envelope({})
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS(), null))
    expect(a.text).toMatch(/^UCT's catalyst board, Fri, Nov 13, 2026/)
    const r = reads()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: KIND, purpose: 'answer', params: {} })
    expect(r[0].turn_id).toMatch(/^t-/)
  })

  it('"why is ZZZ up": one board read for ZZZ, then ONE news.company read only because ZZZ is not on the board and the kind is served', async () => {
    wire([KIND, 'news.company'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KIND] = envelope({ rows: [], not_on_board: ['ZZZ'] })
    ENVS['news.company'] = { contract: 'MD-1.0', kind: 'news.company', status: 'ok', stale: false, fetched_at: FETCHED, data: { symbol: 'ZZZ', items: [{ headline: 'ZZZ synthetic story 1', source: 'Wire C', as_of: '2026-11-13T13:00:00Z' }] } }
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ symbols: ['zzz'] }), null))
    expect(reads().map(x => [x.kind, x.params])).toEqual([[KIND, { symbols: ['ZZZ'] }], ['news.company', { symbol: 'ZZZ', limit: 3 }]])
    expect(a.text).toMatch(/co-occurring only, not an established cause/)
    // on the board → no second read; news.company not served → no second read
    calls = []; ENVS[KIND] = envelope({ rows: [row('AAA')] })
    await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ symbols: ['AAA'] }), null))
    expect(reads().map(x => x.kind)).toEqual([KIND])
  })

  it('watchlist + date + days: the list\'s tickers, the day word resolved, the window passed; an unknown list reads nothing', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KIND] = envelope({ rows: [row('AAA')], not_on_board: ['BBB'] })
    const host = { watchlists: { snapshot: () => [{ id: 'w1', name: 'Momentum', items: [{ id: 1, sym: 'AAA' }, { id: 2, sym: 'BBB' }], shownIn: [], editable: true }] } }
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ watchlist: 'Momentum', date: '2026-11-13', days: 5 }), host))
    expect(reads()[0].params).toEqual({ date: '2026-11-13', days: 5, symbols: ['AAA', 'BBB'] })
    expect(a.text).toMatch(/1 stock from your Momentum watchlist was flagged/)
    calls = []
    expect((await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ watchlist: 'Nope' }), host))).text).toMatch(/couldn't tell which watchlist “Nope” is/)
    expect((await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ date: 'someday' }), host))).text).toMatch(/couldn't read “someday” as a day/)
    expect((await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ watchlist: 'Momentum' }), null))).text).toMatch(/watchlists aren't available on this page/)
    expect(reads()).toEqual([])
  })

  it('a watchlist over 50 symbols: the first 50 are checked and the answer says so', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KIND] = envelope({ rows: [], not_on_board: [] })
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i, sym: `S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}` }))
    const host = { watchlists: { snapshot: () => [{ id: 'w1', name: 'Big', items, shownIn: [], editable: true }] } }
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, ARGS({ watchlist: 'Big' }), host))
    expect(reads()[0].params.symbols).toHaveLength(50)
    expect(a.text).toMatch(/Your Big watchlist has 60 symbols; I checked the first 50\./)
  })

  it('served but no open turn: a plain sentence and no read', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect((await getCapability(CAPABILITY).answer(null, ARGS(), null)).text).toBe("I couldn't read UCT's catalyst board: this needs the Agent's turn, which wasn't available.")
    expect(reads()).toEqual([])
  })
})
