// Phase 2 market intelligence — rs.compare over the `rs.leadership` kind: the member's answer for every scope (as-of,
// method, stale, ambiguous / not-covered refusals, the breadth backdrop with its own label), GROUNDING (every number in
// the text is a fact's), served vs dark, local-only, and routing (an RS / leadership ask routes to the rs group under v1
// and v2; non-RS asks — the RS INDICATOR on a chart, RSI, Compare panel, Period Sort — do not; a dark server routes as
// before). No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic values (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, routeManifest, selectGroups } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import handshake from './__fixtures__/program/isolation.json'
import {
  CAPABILITY, KIND, answerFromRs, rowFacts, registerRsCapability, _resetRsForTest, rsServed, RS_ROUTE_WORDS, dayText,
} from './capabilities/rsLeadership'

registerBuiltins()

const SESSION = '2026-11-12'
const WIN = { from: '2026-10-14', to: SESSION }
const row = (symbol, o = {}) => ({
  symbol, is_etf: false, rated: o.rating != null, rating: o.rating ?? null, d5: o.d5 ?? null, d20: o.d20 ?? null,
  m1: o.m1 ?? null, m3: o.m3 ?? null, m6: null, m12: null, return: o.pct == null ? null : { ...WIN, ...(o.win || {}), pct: o.pct },
  vs_spy: o.vs ?? null, bars_through: o.through ?? SESSION, bars_stale: !!o.bstale, sector: o.sector ?? null, industry: o.industry ?? null,
  ...(o.label ? { label: o.label, is_etf: true } : {}), ...(o.ctx ? { industry_context: o.ctx } : {}),
})
const envelope = (data, over = {}) => ({
  contract: 'MD-1.0', kind: KIND, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2026-11-12T21:00:00Z',
  fetched_at: '2026-11-13T15:00:00Z', delay_s: null, stale: false, source: 'uct-rs', coverage: null, isolated: true,
  notes: ['a provider note that must never be echoed'], provider_calls: 0,
  data: { period: '1M', sessions: 21, benchmark: 'SPY', latest_completed_session: SESSION, leader_rating: 80, rating_session: SESSION,
    ratings_stale: false, benchmark_row: row('SPY', { rating: 61, pct: 2.43 }), ...data }, ...over,
})
const CTX = { members: 40, rated: 31, median: 57.0, paired_20: 30, median_paired_now: 58.0, median_paired_20_ago: 52.5, median_change_20: 5.5,
  at_or_above_80: 9, rising_20: 18, falling_20: 11, top: [{ symbol: 'AAA', rating: 99 }], focus: { symbol: 'NVDA', rating: 95, rank: 3 } }

/** every number token in `text` must be a number in `facts`, or inside a date / label string of one */
function ungrounded(text, facts) {
  const nums = new Set(); const strs = new Set()
  const walk = (v) => {
    if (typeof v === 'number') { nums.add(Math.abs(v)); nums.add(Math.abs(Number(v.toFixed(2)))); return }
    if (typeof v === 'string') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) strs.add(dayText(v)); else if (/\d/.test(v)) strs.add(v); return }
    if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(facts)
  let t = text
  for (const s of [...strs].sort((a, b) => b.length - a.length)) t = t.split(s).join(' ')
  return (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, ''))).filter(x => !nums.has(x))
}

describe('answerFromRs — every scope, grounded', () => {
  it('symbols: rating, 5 / 20-session change, components, return vs SPY over the same window, industry rank', () => {
    const a = answerFromRs(envelope({ scope: 'symbols', rows: [row('NVDA', { rating: 95, d5: 1, d20: 4, m1: 88, m3: 92, pct: 7.53, vs: 5.1, industry: 'Semiconductors', ctx: CTX })] }))
    expect(a.text).toMatch(/^• NVDA \(UCT RS Rating session Nov 12, 2026\): UCT RS Rating 95; 5 sessions earlier 94 \(\+1\); 20 sessions earlier 91 \(\+4\)\. RS components \(percentile\): 1M 88, 3M 92\. 1-month return \+7\.53% \(Oct 14, 2026 → Nov 12, 2026\), \+5\.10 pts vs SPY over the same window\. Industry: Semiconductors — NVDA ranks 3rd of 31 rated members; industry median rating 57; over the 30 members rated both now and 20 sessions earlier, the median went from 52\.5 to 58\./)
    expect(a.text).toMatch(/not a forecast/)
    expect(a.text).not.toMatch(/never be echoed|Stale/)
    expect(a.facts.rows[0].rating_20_ago).toBe(91)
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('symbols: several tickers get a table; an uncovered ticker is named, no figure for it', () => {
    const a = answerFromRs(envelope({ scope: 'symbols', rows: [row('XLK', { rating: 80, d20: 6, pct: 4.2, vs: 1.77, label: 'Technology' }), row('XLE', { rating: 40, d20: -3, pct: -1.5, vs: -3.93, label: 'Energy' }), row('ZZZZ')] }, { status: 'partial' }))
    expect(a.table.columns.map(c => c.label)).toEqual(['Ticker', '1M return', 'vs SPY (pts)', 'RS Rating', 'RS chg 20s'])
    expect(a.table.rows.map(r => r.name)).toEqual(['Technology (XLK)', 'Energy (XLE)', 'ZZZZ'])
    expect(a.text).toMatch(/• ZZZZ \(UCT RS Rating session Nov 12, 2026\): ZZZZ: no UCT RS Rating is stored\. 1-month return n\/a/)
    expect(a.text).toMatch(/Not covered by UCT's stored RS or bars data: ZZZZ\./)
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('a different window is never compared with SPY', () => {
    const a = answerFromRs(envelope({ scope: 'symbols', rows: [row('ABC', { rating: 50, pct: 3, vs: null, win: { to: '2026-11-10' }, bstale: true, through: '2026-11-10' })] }, { stale: true }))
    expect(a.text).toMatch(/\(no SPY comparison: different window\)/)
    expect(a.text).toMatch(/bars only through Nov 10, 2026/)
    expect(a.text).toMatch(/Stale: some bars end before the latest completed session \(Nov 12, 2026\)\./)
  })
  it('sectors: ranked lines, RS with its 20-session change, SPY over the same window', () => {
    const sectors = [row('XLK', { rating: 80, d20: 6, pct: 4.2, vs: 1.77, label: 'Technology' }), row('XLU', { rating: 20, d20: -2, pct: -0.8, vs: -3.23, label: 'Utilities' })]
    const a = answerFromRs(envelope({ scope: 'sectors', sectors, indices: [] }))
    expect(a.text).toMatch(/^Sector leadership — the 2 SPDR sector ETFs ranked by 1-month return \(Oct 14, 2026 → Nov 12, 2026, completed sessions\), with their UCT RS Rating \(UCT RS Rating session Nov 12, 2026\):\n1\. Technology \(XLK\): \+4\.20% \(\+1\.77 pts vs SPY\); RS 80 \(\+6 over 20 sessions\)\.\n2\. Utilities \(XLU\): −0\.80% \(−3\.23 pts vs SPY\); RS 20 \(−2 over 20 sessions\)\.\nSPY over the same window: \+2\.43%\./)
    expect(a.table.rows).toHaveLength(2)
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('industry: the median, the paired 20-session comparison worded as an observation, the top names', () => {
    const a = answerFromRs(envelope({ scope: 'industry', industry: 'Semiconductors', cohort: CTX }))
    expect(a.text).toMatch(/^Semiconductors \(UCT industry group, UCT RS Rating session Nov 12, 2026\): 31 of 40 mapped members carry a rating; median 57; 9 rated 80\+\.\nOver the 30 members rated both now and 20 sessions earlier, the median rating is 58, higher than 52\.5 then \(\+5\.5\); 18 rose, 11 fell\.\nHighest rated: AAA 99\./)
    expect(a.text).not.toMatch(/will|expect|likely/i)
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('industry: ambiguous lists the candidates; not covered says so; no figure either way', () => {
    const amb = answerFromRs(envelope({ scope: 'industry', industry: null, asked: 'software', candidates: ['Software - Application', 'Software - Infrastructure'] }, { status: 'partial', as_of: null }))
    expect(amb.text).toBe('"software" matches several industries in UCT\'s group map: Software - Application; Software - Infrastructure. Which one? No figure is stated.')
    const none = answerFromRs(envelope({ scope: 'industry', industry: null, asked: 'uranium', candidates: [] }, { status: 'partial', as_of: null }))
    expect(none.text).toBe('UCT\'s group map has no industry matching "uranium", so no figure is stated.')
  })
  it('backdrop: index ETFs, sector leaders / laggards, and the breadth reading with its own label', () => {
    const sectors = ['XLK', 'XLI', 'XLF', 'XLV', 'XLU'].map((s, i) => row(s, { rating: 70 - i, pct: 4 - i, label: s.slice(2) }))
    const indices = [row('SPY', { rating: 61, pct: 2.43 }), row('QQQ', { rating: 70, pct: 3.1, vs: 0.67 })]
    const breadth = [{ status: 'ok', data: { metric: 'pct_above_50sma', value: 61.4, label: 'Intraday · 11:52 AM ET', current: true } },
      { status: 'refused', data: null }]
    const a = answerFromRs(envelope({ scope: 'backdrop', sectors, indices }), { breadth })
    expect(a.text).toMatch(/^Market backdrop — historical, 1-month window \(Oct 14, 2026 → Nov 12, 2026, completed sessions\):\n• Index ETFs: SPY \+2\.43%, RS 61; QQQ \+3\.10% \(\+0\.67 pts vs SPY\), RS 70\./)
    expect(a.text).toMatch(/• Sector leaders: K \(XLK\) \+4\.00%, I \(XLI\) \+3\.00%, F \(XLF\) \+2\.00%; laggards: U \(XLU\) \+0\.00%, V \(XLV\) \+1\.00%, F \(XLF\) \+2\.00%/)
    expect(a.text).toMatch(/• US breadth \(UCT breadth\): 61\.4% of stocks above their 50-day SMA \(Intraday · 11:52 AM ET\)\./)
    expect(ungrounded(a.text, a.facts)).toEqual([])
  })
  it('backdrop with no breadth served: said plainly, no breadth figure', () => {
    const a = answerFromRs(envelope({ scope: 'backdrop', sectors: [], indices: [] }))
    expect(a.text).toMatch(/US breadth: not available to the Agent right now, so no breadth figure is stated\./)
  })
  it('stale ratings: the session and the latest completed session', () => {
    const a = answerFromRs(envelope({ scope: 'symbols', rows: [row('NVDA', { rating: 95, pct: 1 })], ratings_stale: true, rating_session: '2026-11-06' }, { stale: true }))
    expect(a.text).toMatch(/Stale: the newest stored RS Rating session is Nov 6, 2026, older than the ratings' freshness rule allows; the latest completed session is Nov 12, 2026\./)
  })
  it('refused / unavailable: one fixed line, no figure', () => {
    expect(answerFromRs({ status: 'refused', data: null }).text).toBe("I couldn't read UCT's relative-strength data: that request wasn't allowed for this question, so no RS data was read. No figure is stated.")
    expect(answerFromRs(null).text).toMatch(/could not answer it right now\. No figure is stated\.$/)
  })
  it('rowFacts: the stated prior ratings are rating − change, and nothing else is derived', () => {
    expect(rowFacts(row('A', { rating: 50, d5: -3, d20: 10 }))).toMatchObject({ rating_5_ago: 53, rating_20_ago: 40 })
    expect(rowFacts(row('A', { rating: 50 }))).toMatchObject({ rating_5_ago: null, rating_20_ago: null })
    expect(rowFacts(null)).toBe(null)
  })
})

// ── served vs dark, local-only, routing, and the end-to-end ask ──
let KINDS, calls, ENVS
function wire(kinds) {
  KINDS = kinds; calls = []
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
const rsGroup = () => GROUPS.find(g => g.id === 'rs')

export const RS_ASKS = [
  'which sectors are leading this month',
  "how does NVDA's RS compare with its industry",
  'is semis RS improving',
  "what's the market backdrop: breadth, indices, leadership",
  'compare XLK, XLF and XLE over 3 months',
  'what is the RS rating of AMD',
  'which industries are the strongest right now',
  'what are the weakest sectors over the last week',
  'how are market conditions',
  'is relative strength in biotech deteriorating',
]
export const NOT_RS = [
  'add the RS indicator', 'show rotation on the RS indicator', 'switch the RS indicator to the rotation view', 'make the RS dots large',
  'put the rrg view in the rs pane', 'what is the RSI of NVDA', 'add the relative strength index', 'compare nvda with amd',
  'open the rotation map', 'compare against the Semiconductors industry', 'rank sectors since oct 1', 'put XLK on the chart',
  'add the 50 day moving average', 'how is US breadth now?', 'show me the news on NVDA', 'switch to the weekly', 'add the RS line to the chart',
]

describe('served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetRsForTest(); vi.restoreAllMocks(); ENVS = {} })
  afterEach(() => { _resetTurns(); _resetRsForTest() })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'breadth.current'], 'other kinds only']])('dark (%j, %s): not registered, the group has no words, routing unchanged', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(rsServed()).toBe(false)
    expect(registerRsCapability()).toBe(false)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(rsGroup().words).toEqual([])
    const full = manifestFor({ surface: 'charts', createIndicator: true })
    for (const q of RS_ASKS) expect(selectGroups(q).selected).not.toContain('rs')
    expect(routeManifest(full, RS_ASKS[0], OPTS()).manifest.some(c => c.name === CAPABILITY)).toBe(false)
  })

  it('served: registers once, local-only on both sides, arms the group words, and unregisters cleanly', async () => {
    wire([KIND])
    await loadAgentConfig()
    expect(rsServed()).toBe(true)
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).toContain(CAPABILITY)
    expect(getCapability(CAPABILITY).localOnly).toBe(true)
    expect(handshake.local_only_actions).toContain(CAPABILITY)       // turn.LOCAL_ONLY_ACTIONS (tests/test_uct_agent_qa_isolation.py)
    expect(handshake.isolated_kinds).toContain(KIND)
    expect(registerRsCapability()).toBe(false)                       // idempotent
    expect(rsGroup().words).toEqual(RS_ROUTE_WORDS)
    expect(rsGroup().wordsOnly && rsGroup().fillLast).toBe(true)
    _resetRsForTest()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(rsGroup().words).toEqual([])
  })

  it('routing (served): every RS / leadership ask routes the rs group under v1 and v2; non-RS asks do not', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of RS_ASKS) {
      expect(selectGroups(q).selected, q).toContain('rs')
      for (const route of [routeManifest, routeManifestV2]) {
        const r = route(full, q, OPTS())
        expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITY)
        expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain('rs')
      }
    }
    for (const q of NOT_RS) {
      expect(selectGroups(q).selected, q).not.toContain('rs')
      const r = routeManifestV2(full, q, OPTS())
      expect(r.manifest.map(c => c.name), `v2: ${q}`).not.toContain(CAPABILITY)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only rs group', async () => {
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

  it('end to end: one rs.leadership read for a sector ask; the backdrop adds the two breadth reads only when breadth is served', async () => {
    wire([KIND, 'breadth.current'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KIND] = envelope({ scope: 'sectors', sectors: [row('XLK', { rating: 80, d20: 6, pct: 4.2, vs: 1.77, label: 'Technology' })], indices: [] })
    const a = await inTurn(() => getCapability(CAPABILITY).answer(null, { scope: 'sectors', symbols: null, industry: null, period: null }))
    expect(a.text).toMatch(/^Sector leadership — the 1 SPDR sector ETFs ranked by 1-month return/)
    expect(reads()).toHaveLength(1)
    expect(reads()[0]).toMatchObject({ kind: KIND, purpose: 'answer', params: { scope: 'sectors', period: '1M' } })
    ENVS[KIND] = envelope({ scope: 'backdrop', sectors: [], indices: [] })
    ENVS['breadth.current'] = { status: 'ok', data: { metric: 'pct_above_50sma', value: 61.4, label: 'Close · Nov 12', current: true } }
    calls.length = 0
    await inTurn(() => getCapability(CAPABILITY).answer(null, { scope: 'backdrop', symbols: null, industry: null, period: '1W' }))
    expect(reads().map(r => [r.kind, r.params.metric || r.params.scope])).toEqual([[KIND, 'backdrop'], ['breadth.current', 'pct_above_50sma'], ['breadth.current', 'pct_above_200sma']])
  })

  it('served but no open turn, no scope, no ticker or no industry: a plain sentence and no read', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const ans = (args) => getCapability(CAPABILITY).answer(null, { symbols: null, industry: null, period: null, ...args })
    expect((await ans({ scope: 'sectors' })).text).toBe("I couldn't read UCT's relative-strength data: this needs the Agent's turn, which wasn't available.")
    for (const args of [{ scope: 'bogus' }, { scope: 'symbols', symbols: [] }, { scope: 'industry', industry: '  ' }]) {
      expect((await inTurn(() => ans(args))).text).toMatch(/No figure is stated\.$/)
    }
    expect(reads()).toEqual([])
  })

  it('symbols are deduplicated, uppercased and capped at 6 before the read', async () => {
    wire([KIND])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KIND] = envelope({ scope: 'symbols', rows: [] })
    await inTurn(() => getCapability(CAPABILITY).answer(null, { scope: 'symbols', symbols: ['nvda', '$NVDA', 'amd', 'a', 'b', 'c', 'd', 'e'], industry: null, period: '3M' }))
    expect(reads()[0].params).toEqual({ scope: 'symbols', period: '3M', symbols: ['NVDA', 'AMD', 'A', 'B', 'C', 'D'] })
  })
})
