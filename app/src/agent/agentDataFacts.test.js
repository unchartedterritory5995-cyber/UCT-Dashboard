// W1-C C-02 (builder-c): the four server-only MD-1 kinds wired to capabilities — `fundamentals` → stock.profile,
// `earnings` → stock.earnings, `news.company` → news.latest, `themes` → stock.themes (server-gated) — with MD-1
// freshness wording; the legacy routes only while the gateway says the kind is off. No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, allCapabilityNames } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import {
  fundamentalsFacts, answerFromEarnings, answerFromNews, answerFromThemes, kindServed, quoteLine,
  registerMarketFactsCapabilities, _resetFactsForTest, THEMES_CAPABILITY,
} from './capabilities/marketDataFacts'

registerBuiltins()

const FETCHED = '2026-11-02T15:30:05Z'
const envelope = (kind, params, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: params, status: 'ok', freshness: 'periodic', as_of: '2026-07-31T00:00:00Z',
  fetched_at: FETCHED, delay_s: null, stale: false, source: 'x', coverage: null, data: null, notes: ['a provider note that must never be echoed'], provider_calls: 0, ...over,
})
const FUND = envelope('fundamentals', { symbol: 'NVDA' }, { source: 'yahoo-finance', data: {
  symbol: 'NVDA', period: 'quarterly', currency: 'USD', fiscal_year_end: null, units: null,
  statements: {
    income: [{ period_end: '2026-07-31', values: { revenue: 46743000000, gross_profit: 33800000000, operating_income: 28400000000, net_income: 26400000000, eps_diluted: 1.08 } }],
    balance: [{ period_end: '2026-07-31', values: { cash: 15000000000, total_assets: 140000000000, total_debt: 8500000000, equity: 100000000000 } }],
  } } })
const EARN = envelope('earnings', { symbol: 'NVDA' }, { source: 'uct-earnings', as_of: null, data: {
  symbol: 'NVDA', reported_through: '2026 Q2', quarters_behind: 0,
  reported: [{ quarter: '2026 Q1', eps_actual: 0.9, eps_estimate: 0.85, eps_surprise_pct: 5.9, rev_actual: 44000000000, rev_estimate: 43000000000, rev_surprise_pct: 2.3 },
    { quarter: '2026 Q2', eps_actual: 1.08, eps_estimate: 1.01, eps_surprise_pct: 6.9, rev_actual: 46743000000, rev_estimate: 46000000000, rev_surprise_pct: 1.6 }],
  next_report: { report_date: '2026-11-19', quarter: '2026 Q3', eps_estimate: 1.25, rev_estimate: 54000000000, kind: 'scheduled' } } })
const NEWS = envelope('news.company', { symbol: 'NVDA', limit: 8 }, { source: 'uct-news', as_of: '2026-11-02T13:05:00Z', data: {
  symbol: 'NVDA', has_more: true, items: [
    { headline: 'NVIDIA announces a thing', url: 'https://x/1', source: 'Wire', source_class: 'press', category: 'company', sentiment: 'positive', as_of: '2026-11-02T13:05:00Z' },
    { headline: 'Analysts weigh in', url: 'https://x/2', source: 'Paper', source_class: 'media', category: 'company', sentiment: null, as_of: '2026-11-01T22:40:00Z' },
  ] } })
const THEMES = envelope('themes', { period: '1w', order: 'leaders', limit: 10 }, { source: 'uct-themes', as_of: '2026-10-30T20:00:00Z',
  coverage: { evaluated: 12, answered: 10, dropped: 0, not_computable: 2 }, status: 'partial', data: {
    period: '1w', order: 'leaders', live_applied_at: null,
    themes: [{ name: 'Nuclear', ticker: 'NUKE', sector: 'Energy', return_pct: 8.25, holdings: 14 }, { name: 'Quantum', ticker: 'QBIT', sector: 'Technology', return_pct: 5.1, holdings: 9 }] } })

describe('pure envelope → answer (freshness from the envelope, never its notes)', () => {
  it('fundamentals: the facts block — the newest period, the statements carried, periodic wording, the missing statement named', () => {
    const f = fundamentalsFacts(FUND, 'NVDA')
    expect(f.lines[0]).toBe('Financial statements (quarterly, newest period ending Jul 31, 2026):')
    expect(f.lines[1]).toBe('• Income statement (period ending Jul 31, 2026): Revenue $46.74B · Gross profit $33.80B · Operating income $28.40B · Net income $26.40B · EPS (diluted) $1.08')
    expect(f.lines[2]).toBe('• Balance sheet (period ending Jul 31, 2026): Cash $15.00B · Total assets $140.00B · Total debt $8.50B · Shareholder equity $100.00B')
    expect(f.lines[3]).toBe('No cash flow data is carried for NVDA.')
    expect(f.lines[4]).toBe('Periodic disclosures: the statement figures describe the reporting period ending Jul 31, 2026, not today.')
    expect(f.source).toBe('statements from Yahoo Finance through the UCT data gateway')
    expect(f.lines.join(' ')).not.toMatch(/never be echoed|\blive\b/)
    expect(f.items.map(i => i.label)).toContain('Net income')
    expect(f.items[0].note).toBe('period ending Jul 31, 2026')
  })
  it('fundamentals: a stale read says how old the period is; refused / unavailable are one fixed line with no figure', () => {
    const stale = { ...FUND, stale: true, as_of: '2026-01-31T00:00:00Z' }
    expect(fundamentalsFacts(stale, 'NVDA').lines.at(-1)).toMatch(/Note: that period ended 275 days ago, so a newer quarter may have been reported\.$/)
    const r = fundamentalsFacts({ ...FUND, status: 'refused', data: null, freshness: 'unavailable', as_of: null }, 'NVDA')
    expect(r).toEqual({ lines: ["Financial statements: that request wasn't allowed for this question, so its financial statements are not available; no statement figure is stated."], items: [], source: null })
    expect(fundamentalsFacts(null, 'NVDA').lines[0]).toMatch(/not available from UCT's market data; no statement figure is stated\./)
  })
  it('earnings: the newest reported quarter, estimates kept apart, the next report as a scheduled event, no report date claimed', () => {
    const a = answerFromEarnings(EARN, 'NVDA')
    expect(a.text).toMatch(/Latest reported quarter: 2026 Q2/)
    expect(a.text).toMatch(/• Revenue \$46\.74B vs \$46\.00B estimated \(\+1\.60% surprise\)/)
    expect(a.text).toMatch(/• EPS \$1\.08 vs \$1\.01 estimated \(\+6\.90% surprise\)/)
    expect(a.text).toMatch(/Next report: scheduled for Nov 19, 2026 \(2026 Q3\) · EPS est\. \$1\.25, revenue est\. \$54\.00B — a scheduled event, not a result\./)
    expect(a.text).toMatch(/Reported quarters carry no report date in UCT's earnings data; reported through 2026 Q2\./)
    expect(a.text).not.toMatch(/never be echoed|quarters behind/)
    const behind = answerFromEarnings({ ...EARN, stale: true, data: { ...EARN.data, quarters_behind: 2, next_report: null } }, 'NVDA')
    expect(behind.text).toMatch(/Next report date: not available in UCT's earnings data\./)
    expect(behind.text).toMatch(/Note: these results are 2 quarters behind what a typical filer has reported by now\./)
  })
  it('news: newest first with ET times, the ingest-health note only when stale, zero items said as not-stale', () => {
    const a = answerFromNews(NEWS, 'NVDA')
    expect(a.text).toMatch(/^Latest 2 headlines UCT has stored for NVDA \(newest published 8:05 AM ET\)\./)
    expect(a.table.rows[1].when).toBe('Sun, Nov 1, 5:40 PM ET')
    expect(a.present.kind).toBe('headlines')
    expect(a.text).toMatch(/Source: UCT's news store through the UCT data gateway \(not a live web search\)/)
    expect(a.text).not.toMatch(/never be echoed/)
    expect(answerFromNews({ ...NEWS, stale: true }, 'NVDA').text).toMatch(/Note: UCT's news ingest hasn't succeeded for over an hour, so recent stories may be missing\./)
    const old = answerFromNews({ ...NEWS, as_of: '2026-10-20T13:05:00Z' }, 'NVDA')
    expect(old.text).toMatch(/the newest is 13 days old, so this is not breaking news\./)
    const none = answerFromNews({ ...NEWS, as_of: null, data: { symbol: 'NVDA', items: [], has_more: false } }, 'NVDA')
    expect(none.text).toBe('UCT has no stored news for NVDA — that is not a sign of stale data.')
  })
  it('themes: equal-weight returns as of the session close, the not-computable count, stale said; intraday apply time is not live', () => {
    const a = answerFromThemes(THEMES)
    expect(a.text).toMatch(/^Theme leaders over one week \(as of the Oct 30, 2026 close\): equal-weight returns of UCT's curated themes, not live prices\. 2 themes have no one week return yet\./)
    expect(a.text).toMatch(/Nuclear \+8\.25% · Quantum \+5\.10%/)
    expect(a.table.rows[0]).toEqual({ theme: 'Nuclear', ret: '+8.25%', sector: 'Energy', holdings: '14' })
    expect(a.text).not.toMatch(/never be echoed/)
    const intraday = answerFromThemes({ ...THEMES, as_of: null, data: { ...THEMES.data, live_applied_at: '2026-11-02T15:20:00Z' } })
    expect(intraday.text).toMatch(/\(including intraday prices UCT applied at 10:20 AM ET — not a live feed\)/)
    expect(answerFromThemes({ ...THEMES, stale: true }).text).toMatch(/Note: these returns were computed before the last completed session, so they are behind\./)
    expect(answerFromThemes({ ...THEMES, status: 'unavailable', data: null, freshness: 'unavailable', as_of: null }).text).toMatch(/theme data may still be warming/)
  })
  it('quoteLine: "live" only for a live row', () => {
    expect(quoteLine({ price: 10, changePct: -1.5, when: '9:45 AM ET', live: false })).toBe('Price $10.00, −1.50% vs the previous close — as of 9:45 AM ET, not a real-time price')
    expect(quoteLine({ price: 10, changePct: null, when: null, live: true })).toBe('Price $10.00 — live')
  })
})

// ── the gateway seam: each legacy capability takes the kind's path ONLY while the server lists it ──
let KINDS, calls
function wire(kinds) {
  KINDS = kinds; calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    calls.push([u, init?.body ? JSON.parse(init.body) : null])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: KINDS !== null, scan: false, data_kinds: KINDS || [] })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      return json({ fundamentals: FUND, earnings: EARN, 'news.company': NEWS, themes: THEMES }[b.kind] || { ...FUND, kind: b.kind, status: 'refused', data: null, freshness: 'unavailable', as_of: null })
    }
    if (u.startsWith('/api/fundamentals-full/')) return json({ ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', market_cap: '$5.64T', price: 233.49 })
    if (u.startsWith('/api/earnings-intel/')) return json({ ticker: 'NVDA', quarters: [], summary: {} })
    if (u.startsWith('/api/company-news/')) return json({ items: [{ headline: 'Legacy headline', published_at: '2026-11-02T12:00:00Z', source_display: 'Wire' }] })
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }

describe('served vs dark: stock.profile / stock.earnings / news.latest / stock.themes', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetFactsForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetTurns(); _resetFactsForTest() })

  it('all four kinds on: each capability makes exactly one read of its kind for the open turn; stock.themes registers', async () => {
    wire(['fundamentals', 'earnings', 'news.company', 'themes'])
    await loadAgentConfig()
    expect(['fundamentals', 'earnings', 'news.company', 'themes'].every(kindServed)).toBe(true)
    expect(registerServerGatedBuiltins()).toBeUndefined()
    expect(allCapabilityNames()).toContain(THEMES_CAPABILITY)
    const profile = await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'nvda' }))
    // never degraded: the member's snapshot fields stay, the gateway's statements are added with their own wording
    expect(profile.text).toMatch(/^NVDA — NVIDIA Corporation · Technology/)
    expect(profile.text).toMatch(/Market cap \$5\.64T/)
    expect(profile.text).toContain('\nFinancial statements (quarterly, newest period ending Jul 31, 2026):\n• Income statement')
    expect(profile.text).toMatch(/Periodic disclosures: the statement figures describe the reporting period ending Jul 31, 2026, not today\./)
    expect(profile.text).toMatch(/Source: UCT fundamentals .*; statements from Yahoo Finance through the UCT data gateway\.$/)
    expect(profile.present.items.map(i => i.label)).toEqual(expect.arrayContaining(['Market cap', 'Net income']))
    const earnings = await inTurn(() => getCapability('stock.earnings').answer(null, { symbol: 'NVDA' }))
    expect(earnings.text).toMatch(/Latest reported quarter: 2026 Q2/)
    const news = await inTurn(() => getCapability('news.latest').answer(null, { symbol: 'NVDA', limit: null }))
    expect(news.text).toMatch(/headlines UCT has stored for NVDA/)
    const themes = await inTurn(() => getCapability(THEMES_CAPABILITY).answer(null, { period: '1w', order: null, limit: null }))
    expect(themes.text).toMatch(/^Theme leaders over one week/)
    const r = reads()
    expect(r.map(x => x.kind)).toEqual(['fundamentals', 'earnings', 'news.company', 'themes'])
    expect(r.map(x => x.purpose)).toEqual(['answer', 'answer', 'answer', 'answer'])
    expect(r.every(x => /^t-/.test(x.turn_id))).toBe(true)
    expect(r[0].params).toEqual({ symbol: 'NVDA', period: 'quarterly', periods: 4 })
    expect(r[2].params).toEqual({ symbol: 'NVDA', limit: 8 })
    expect(r[3].params).toEqual({ period: '1w', order: 'leaders', limit: 10 })
    // the profile keeps its member route (never degraded); the earnings / news legacy routes were not touched
    expect(calls.some(c => /earnings-intel|company-news/.test(c[0]))).toBe(false)
    expect(calls.filter(c => c[0].startsWith('/api/fundamentals-full/'))).toHaveLength(1)
  })
  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'quotes'], 'only the price kinds']])('dark (%j, %s): legacy routes, no gateway read, stock.themes not registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerMarketFactsCapabilities()).toBe(false)
    expect(allCapabilityNames()).not.toContain(THEMES_CAPABILITY)
    const profile = await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'NVDA' }))
    expect(profile.text).toMatch(/^NVDA — NVIDIA Corporation · Technology/)
    expect(profile.text).not.toMatch(/Financial statements/)
    const earnings = await inTurn(() => getCapability('stock.earnings').answer(null, { symbol: 'NVDA' }))
    expect(earnings.text).toMatch(/No reported quarter is available for NVDA\./)
    const news = await inTurn(() => getCapability('news.latest').answer(null, { symbol: 'NVDA', limit: null }))
    expect(news.text).toMatch(/Legacy headline|headlines? UCT has for NVDA/)
    expect(reads().filter(x => x.kind !== 'quote')).toEqual([])
    expect(calls.some(c => c[0].startsWith('/api/fundamentals-full/'))).toBe(true)
  })
  it('one kind on, the others off: only that capability moves', async () => {
    wire(['earnings'])
    await loadAgentConfig()
    const profile = await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'NVDA' }))
    expect(profile.text).toMatch(/^NVDA — NVIDIA Corporation/)
    const earnings = await inTurn(() => getCapability('stock.earnings').answer(null, { symbol: 'NVDA' }))
    expect(earnings.text).toMatch(/Latest reported quarter: 2026 Q2/)
    expect(reads().map(x => x.kind)).toEqual(['earnings'])
  })
  it('served but no open turn: a plain sentence, no read', async () => {
    wire(['earnings', 'themes'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(await getCapability('stock.earnings').answer(null, { symbol: 'NVDA' })).toBe("I couldn't read NVDA's earnings: this needs the Agent's turn, which wasn't available.")
    expect(await getCapability(THEMES_CAPABILITY).answer(null, { period: null, order: null, limit: null })).toBe("I couldn't read UCT's theme returns: this needs the Agent's turn, which wasn't available.")
    expect(reads()).toEqual([])
  })
})
