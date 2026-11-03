// Batch 1: navigation (app.open), stock data (stock.*) and settings (settings.*).
// Fixture responses are the REAL endpoints' shapes, measured on a local backend
// 2026-10-08 (/api/fundamentals-full, /api/earnings-intel, /api/research/compare).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { manifestFor, getCapability, buildContext } from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'
import { DESTINATIONS } from './capabilities/app'
import { NAV_ITEMS } from '../components/NavBar'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'

registerBuiltins()
const CTX = { surface: 'charts' }
const KNOWN = new Set(['NVDA', 'AMD', 'TSLA'])
const FULL = { ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors', market_cap: '$5.64T', pe_trailing: 29.52, pe_forward: 14.67, ps: 18.61, total_revenue: '$302.97B', revenue_growth_pct: 105.9, gross_margin_pct: 74.7, operating_margin_pct: 66.2, profit_margin_pct: 63.7, price: 233.49, fifty_two_week_high: 243.37, fifty_two_week_low: 164.27, beta: 2.22, next_earnings: '2026-11-17' }
const EI = {
  ticker: 'NVDA', currency: 'USD', next_report_date: null,
  quarters: [{ label: 'FY2027 Q2', period_end: '2026-07-31', reported: true, eps_actual: 2.46, revenue_actual: 96221000000, eps_estimate: 2.31, revenue_estimate: 94000000000, eps_surprise_pct: 6.5, rev_surprise_pct: 2.4, rev_yoy_pct: 68.8, eps_basis: 'gaap_diluted' }],
  summary: { next_report_date: '2026-11-17', next_report_label: 'FY2027 Q3', next_eps_estimate: 2.6, next_revenue_estimate: 101000000000 },
  meta: { retrieved_at: 1791478230 },
}
let calls, live, gateway
// W1-C C-04: the profile's price line is the MD-1 `quote` kind (a live regular-session trade here); never /api/live-prices.
const QUOTE_ENV = (sym) => ({ contract: 'MD-1.0', kind: 'quote', params_echo: { symbol: sym }, status: 'ok', freshness: 'live', as_of: '2026-11-02T15:30:00Z',
  fetched_at: '2026-11-02T15:30:05Z', delay_s: null, stale: false, source: 'massive', coverage: null, provider_calls: 1, notes: [],
  data: { quote: { symbol: sym, last: 233.5, change: 2.86, change_pct: 1.24, last_source: 'trade', as_of: '2026-11-02T15:30:00Z' }, session: 'regular', session_detail: 'regular' } })
beforeEach(async () => {
  _resetAgentConfig(); _resetTurns()
  calls = []; live = { NVDA: QUOTE_ENV('NVDA') }; gateway = true
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url); calls.push(u)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u.startsWith('/api/fundamentals-full/')) return u.endsWith('/NVDA') ? json(FULL) : json({ detail: 'not found' }, 404)
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent stock read called /api/live-prices')
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: gateway, scan: false, data_kinds: gateway ? ['quote'] : [] })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      const e = live[b.params.symbol]
      return json(e || { ...QUOTE_ENV(b.params.symbol), status: 'unavailable', freshness: 'unavailable', as_of: null, data: null, notes: ['no quote'] })
    }
    if (u.startsWith('/api/earnings-intel/')) return u.endsWith('/NVDA') ? json(EI) : json({ ticker: 'AMD', quarters: [], summary: {} })
    if (u.startsWith('/api/research/compare/')) return json({ a: { sym: 'NVDA', fundamentals: FULL, ratings: { composite: 88 } }, b: { sym: 'AMD', fundamentals: { ...FULL, ticker: 'AMD', market_cap: '$270B', pe_forward: 30.1 }, ratings: { composite: 71 } }, fundamentals_period_note: 'Not guaranteed to be the same period.' })
    if (u.startsWith('/api/ticker-search')) {
      const q = new URL(u, 'http://x').searchParams.get('q')
      return json({ results: KNOWN.has(q) ? [{ ticker: q }] : [] })
    }
    if (u.startsWith('/api/watchlist-alerts')) return json([])
    return json({})
  })
  await loadAgentConfig()
})
afterEach(() => { _resetTurns(); vi.restoreAllMocks(); vi.useRealTimers() })
/** A capability answer inside one member turn (trace.js), as the panel runs it: the gateway read is keyed by it. */
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }

function host({ prefs = {}, writeOk = true } = {}) {
  const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
  const store = { theme: 'oled', default_chart_tf: 'D', alert_sound: 'on', alert_sound_type: 'chime', ...prefs }
  const writes = []
  const nav = []
  b.host.prefs = {
    read: () => store,
    write: async (k, v) => { writes.push([k, v]); const ok = typeof writeOk === 'function' ? writeOk(k, v, writes.length) : writeOk; if (ok) store[k] = v; return ok },
  }
  b.host.navigate = (to) => nav.push(to)
  return { ...b, store, writes, nav }
}
async function plan(h, ops, kinds) {
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, kinds), ops, env, CTX), env }
}
const why = (p) => p.refusals.map(r => r.reason).join(' | ')

describe('discovery: eight new actions, all closed schemas, in the manifest', () => {
  it('names, risks and value lists', () => {
    const names = manifestFor(CTX).map(c => c.name)
    for (const n of ['app.open', 'stock.profile', 'stock.earnings', 'stock.compare', 'settings.show', 'settings.setAppTheme', 'settings.setDefaultTimeframe', 'settings.setAlertSound']) expect(names).toContain(n)
    for (const n of ['stock.profile', 'stock.earnings', 'stock.compare', 'settings.show']) expect(getCapability(n).query).toBe(true)
    expect(getCapability('settings.setDefaultTimeframe').args.properties.timeframe.enum).toEqual(['5', '30', '60', 'D', 'W'])
    expect(getCapability('settings.setAppTheme').args.properties.theme.enum).toEqual(expect.arrayContaining(['dark', 'oled', 'light', 'slate', 'paper']))
  })
  it('navigation destinations ARE the sidebar (NAV_ITEMS) + Settings + Research — nothing invented', () => {
    for (const i of NAV_ITEMS) expect(Object.values(DESTINATIONS).some(d => d.to === i.to)).toBe(true)
    expect(Object.keys(DESTINATIONS).length).toBe(NAV_ITEMS.length + 2)
    expect(getCapability('app.open').args.properties.page.enum).toEqual(Object.keys(DESTINATIONS))
  })
})

describe('stock.* — deterministic answers from UCT data, sources and freshness stated', () => {
  it('profile: name, sector, the gateway LIVE price with its time (one `quote` read for the turn), market cap, P/E, next earnings; Research link', async () => {
    const a = await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'nvda' }))
    expect(a.text).toMatch(/^NVDA — NVIDIA Corporation · Technology \/ Semiconductors/)
    expect(a.text).toMatch(/Price \$233\.50, \+1\.24% vs the previous close — live, as of .* ET/)
    expect(a.text).toMatch(/Market cap \$5\.64T · P\/E 29\.52 trailing, 14\.67 forward/)
    expect(a.text).toMatch(/Next earnings: Nov 17, 2026/)
    expect(a.text).toMatch(/Source: UCT fundamentals .*; price from the Massive market snapshot through the UCT data gateway/)
    expect(a.link.href).toBe('/research/NVDA')
    expect(calls.filter(u => u === '/api/agent/data')).toHaveLength(1)
    expect(calls.some(u => u.startsWith('/api/live-prices'))).toBe(false)
  })
  it('profile with a stale / closed quote never says live; without a usable quote the price is from the snapshot and said so', async () => {
    live = { NVDA: { ...QUOTE_ENV('NVDA'), freshness: 'historical', data: { ...QUOTE_ENV('NVDA').data, quote: { ...QUOTE_ENV('NVDA').data.quote, last_source: 'day_close', as_of: '2026-10-30T20:00:00Z' }, session_detail: 'closed' } } }
    const closed = await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'NVDA' }))
    expect(closed.text).toMatch(/Price \$233\.50, \+1\.24% vs the previous close — as of Fri, Oct 30, 4:00 PM ET, not a real-time price/)
    expect(closed.text).not.toMatch(/\blive\b/)
    live = {}
    expect((await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'NVDA' }))).text).toMatch(/Price \$233\.49 \(from the fundamentals snapshot — a current quote wasn't available through the Agent's data gateway\)/)
    expect(await getCapability('stock.profile').answer(null, { symbol: 'ZZZQ' })).toBe('UCT has no data for “ZZZQ”.')
    expect(await getCapability('stock.profile').answer(null, { symbol: 'not a ticker!' })).toMatch(/doesn't look like a ticker/)
  })
  it('profile with the gateway DARK (or no open turn): no quote read at all, never /api/live-prices, the snapshot price is said as such', async () => {
    const noTurn = await getCapability('stock.profile').answer(null, { symbol: 'NVDA' })      // served, but no turn is open
    expect(noTurn.text).toMatch(/a current quote wasn't available through the Agent's data gateway/)
    gateway = false; _resetAgentConfig(); await loadAgentConfig(); calls = []
    const dark = await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'NVDA' }))
    expect(dark.text).toMatch(/Price \$233\.49 \(from the fundamentals snapshot — a current quote wasn't available through the Agent's data gateway\)/)
    expect(dark.text).toMatch(/no current quote was available through the Agent's data gateway\./)
    expect(calls.filter(u => u === '/api/agent/data')).toHaveLength(0)
    expect(calls.some(u => u.startsWith('/api/live-prices'))).toBe(false)
  })
  it('earnings: REPORTED vs ESTIMATED kept apart; next report with its estimates; missing data never filled in', async () => {
    const a = await getCapability('stock.earnings').answer(null, { symbol: 'NVDA' })
    expect(a.text).toMatch(/Latest reported quarter: FY2027 Q2 \(quarter ended Jul 31, 2026\)/)
    expect(a.text).toMatch(/Revenue \$96\.22B vs \$94\.00B estimated \(\+2\.4% surprise\) · \+68\.8% year over year/)
    expect(a.text).toMatch(/EPS \$2\.46 vs \$2\.31 estimated \(\+6\.5% surprise\) · basis: gaap diluted/)
    expect(a.text).toMatch(/Next report: Nov 17, 2026 \(FY2027 Q3\) · EPS est\. \$2\.60, revenue est\. \$101\.00B/)
    const none = await getCapability('stock.earnings').answer(null, { symbol: 'AMD' })
    expect(none.text).toMatch(/No reported quarter is available for AMD\./)
    expect(none.text).toMatch(/Next report date: not available in UCT's earnings data\./)
  })
  it('compare: exactly two tickers → a table from the Research compare payload, with its period caveat', async () => {
    const a = await getCapability('stock.compare').answer(null, { symbols: ['nvda', 'AMD'] })
    expect(a.table.columns.map(c => c.label)).toEqual(['', 'NVDA', 'AMD'])
    expect(a.table.rows.find(r => r.metric === 'Market cap')).toEqual({ metric: 'Market cap', a: '$5.64T', b: '$270B' })
    // F-12 (owner, Sprint 2): the payload carries ratings 88 / 71, and the Agent's compare shows neither
    expect(a.table.rows.some(r => /\brating\b|composite/i.test(r.metric))).toBe(false)
    expect(JSON.stringify(a)).not.toMatch(/\b(88|71)\b/)
    expect(a.text).toMatch(/Not guaranteed to be the same period/)
    expect(await getCapability('stock.compare').answer(null, { symbols: ['NVDA'] })).toBe('Name exactly two tickers to compare.')
  })
  it('a stock question makes NO model or research call of its own (one HTTP read per source)', async () => {
    calls = []
    await inTurn(() => getCapability('stock.profile').answer(null, { symbol: 'NVDA' }))
    expect(calls.filter(u => u.startsWith('/api/agent') && u !== '/api/agent/data')).toHaveLength(0)   // the one data read is the quote (C-04), never a turn
    expect(calls.filter(u => u.startsWith('/api/fundamentals-full'))).toHaveLength(1)
  })
})

describe('settings.* — the Settings page\'s writer, confirmed by the server, exact Undo', () => {
  const K = ['settings']
  it('show: current values from the member\'s real preferences', () => {
    const h = host({ prefs: { theme: 'uct:slate', default_chart_tf: 'W', alert_sound: 'off' } })
    const f = fastParse('show my settings', { host: h.host })
    expect(f.ops[0].action).toBe('settings.show')
    const a = getCapability('settings.show').answer(collectTargets(h.host, K).get('settings').snap)
    expect(a.text).toBe('App theme: Slate (dark)\nDefault chart timeframe: Weekly\nAlert sound: off')
  })
  it('"switch to light mode": one confirmed write of theme=light; Undo writes back exactly the old value', async () => {
    const h = host()
    const { p, env } = await plan(h.host, [{ action: 'settings.setAppTheme', target: 'settings', args: { theme: 'light' } }], K)
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')
    expect(p.lines).toEqual(['App theme: OLED Black → Light'])
    const res = await commitPlan(h.host, p, { env })
    expect(res.ok).toBe(true)
    expect(h.writes).toEqual([['theme', 'light']])
    expect((await undoEntry(h.host, res.undo)).ok).toBe(true)
    expect(h.writes[1]).toEqual(['theme', 'oled'])
  })
  it('a UCT catalog theme is written as its canonical value (uct:<id>)', async () => {
    const h = host()
    const { p, env } = await plan(h.host, [{ action: 'settings.setAppTheme', target: 'settings', args: { theme: 'paper' } }], K)
    await commitPlan(h.host, p, { env })
    expect(h.writes).toEqual([['theme', 'uct:paper']])
  })
  it('NOT CONFIRMED by the server → the receipt says it failed; nothing is claimed; a half-done pair is put back', async () => {
    const h = host({ writeOk: (k, v, n) => n !== 2 })            // the 2nd write is refused
    const { p, env } = await plan(h.host, [{ action: 'settings.setAlertSound', target: 'settings', args: { enabled: true, sound: 'bell' } }], K)
    const h2 = host({ prefs: { alert_sound: 'off' }, writeOk: (k, v, n) => n !== 2 })
    const { p: p2, env: env2 } = await plan(h2.host, [{ action: 'settings.setAlertSound', target: 'settings', args: { enabled: true, sound: 'bell' } }], K)
    const res = await commitPlan(h2.host, p2, { env: env2 })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/the server did not confirm the change, so it is not saved/)
    expect(h2.writes[0]).toEqual(['alert_sound', 'on'])
    expect(h2.writes.at(-1)).toEqual(['alert_sound', 'off'])      // put back
    expect(p.ok).toBe(true)
    expect(env).toBeDefined()
  })
  it('STALE Undo: the setting was changed again since (e.g. in Settings) → Undo refused, nothing overwritten', async () => {
    const h = host()
    const { p, env } = await plan(h.host, [{ action: 'settings.setDefaultTimeframe', target: 'settings', args: { timeframe: 'W' } }], K)
    const res = await commitPlan(h.host, p, { env })
    h.store.default_chart_tf = '60'                                 // changed elsewhere
    const back = await undoEntry(h.host, res.undo)
    expect(back.ok).toBe(false)
    expect(h.store.default_chart_tf).toBe('60')
  })
  it('invalid values never reach the writer (closed enums); a no-op is said as one', async () => {
    const h = host()
    expect((await plan(h.host, [{ action: 'settings.setDefaultTimeframe', target: 'settings', args: { timeframe: '15' } }], K)).p.ok).toBe(false)
    expect((await plan(h.host, [{ action: 'settings.setAppTheme', target: 'settings', args: { theme: 'neon-pink' } }], K)).p.ok).toBe(false)
    expect((await plan(h.host, [{ action: 'settings.setAlertSound', target: 'settings', args: { enabled: null, sound: null } }], K)).p.ok).toBe(false)
    const { p } = await plan(h.host, [{ action: 'settings.setDefaultTimeframe', target: 'settings', args: { timeframe: 'D' } }], K)
    expect(p.changed).toBe(false)
    expect(h.writes).toHaveLength(0)
  })
})

describe('app.open — allow-listed pages, router navigation AFTER the receipt', () => {
  const K = ['app']
  it('"open the screener" (fast path) → /screener, after the receipt; no Undo', async () => {
    const h = host()
    const f = fastParse('open the screener', { host: h.host })
    expect(f.ops[0]).toMatchObject({ action: 'app.open', args: { page: 'screener', section: null, symbol: null } })
    const { p, env } = await plan(h.host, [{ ...f.ops[0], target: 'app' }], K)
    expect(p.lines[0]).toMatch(/^Opening Screener — this panel closes; your conversation is kept/)
    const res = await commitPlan(h.host, p, { env })
    expect(res.ok).toBe(true)
    expect(res.undo).toBeNull()
    expect(h.nav).toEqual([])                                       // not yet: the receipt shows first
    await new Promise(r => setTimeout(r, 1000))
    expect(h.nav).toEqual(['/screener'])
  })
  it('Settings section and a stock\'s Research page; their arguments are checked', async () => {
    const h = host()
    const go = async (args) => (await plan(h.host, [{ action: 'app.open', target: 'app', args }], K)).p
    expect((await go({ page: 'settings', section: 'preferences', symbol: null })).plans[0].after.go.path).toBe('/settings?section=preferences')
    expect((await go({ page: 'research', section: null, symbol: 'nvda' })).plans[0].after.go.path).toBe('/research/NVDA')
    expect(why(await go({ page: 'research', section: null, symbol: 'ZZZQ' }))).toMatch(/UCT has no symbol “ZZZQ”/)
    expect(why(await go({ page: 'research', section: null, symbol: null }))).toMatch(/Which stock/)
    expect(why(await go({ page: 'screener', section: 'charts', symbol: null }))).toMatch(/only applies to Settings/)
    expect((await go({ page: 'https://evil.example', section: null, symbol: null })).ok).toBe(false)    // never a URL
    expect((await go({ page: 'admin', section: null, symbol: null })).ok).toBe(false)                 // not in the list
    const here = await go({ page: 'charts', section: null, symbol: null })
    expect(here.changed).toBe(false)
  })
  it('the context offers the app target only when the host can navigate', () => {
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    expect(buildContext(b.host, CTX).context.app).toBeUndefined()
    b.host.navigate = () => {}
    expect(buildContext(b.host, CTX).context.app[0]).toMatchObject({ current: 'Charts' })
  })
})
