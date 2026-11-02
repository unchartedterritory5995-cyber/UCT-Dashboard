// stock.quote (Sprint 2 B, owner agent-md): the phrase parser is held to docs/agent/program/contracts/MD-1-phrasings.md
// ROW BY ROW (the doc is parsed, not restated), every session state answers honestly, nothing envelope-shaped reaches
// the output, and with the data gateway off everything is exactly stock.profile.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { parsePriceSentence, tickersOf } from './capabilities/marketDataPhrases'
import { match, answerQuote, answerFromEnvelope, describeRow, registerMarketDataCapabilities, _resetForTest, CAPABILITY } from './capabilities/marketDataQuote'
import { answerProfile } from './capabilities/stock'
import { allCapabilityNames } from './capabilities'

// the turn id comes from trace.js only (agent-qa's readDataTurnId rail); the tests set it there
let TURN = 't1'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
// agent-lead #621's per-kind activation, as /api/agent/config reports it; null = an older server with no list
let KINDS = null
vi.mock('./agentClient', async (orig) => ({ ...(await orig()), serverDataKinds: () => KINDS }))

const here = dirname(fileURLToPath(import.meta.url))
const DOC = readFileSync(resolve(here, '../../../docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

// ── the phrasings table, read from the doc ────────────────────────────────────────────────────────────────────────
const ROWS = DOC.split('\n').filter(l => /^\| P\d\d \|/.test(l)).map(l => {
  const c = l.split('|').map(s => s.trim())
  const [id, phrase, handling, ap] = [c[1], c[2], c[3], c[4]]
  const action = (ap.match(/`([a-z.A-Z0-9]+)`/) || [])[1] || null
  const params = ap.split('→')[1] || ''
  const syms = (params.match(/\b[A-Z][A-Z0-9]*(\.[A-Z])?\b/g) || []).filter(w => !['NVDA_'].includes(w))
  const n = (params.match(/\bn: (\d+)/) || [])[1]
  return { id, phrase, handling, action, syms, n: n ? Number(n) : null }
})

describe('MD-1 phrasings doc (the table the fast path is held to)', () => {
  it('has the 30 rows', () => {
    expect(ROWS.map(r => r.id)).toEqual(Array.from({ length: 30 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`))
    expect(ROWS.every(r => ['fast', 'model', 'clarify'].includes(r.handling))).toBe(true)
  })

  it.each(ROWS)('$id "$phrase" → $handling', (r) => {
    const p = parsePriceSentence(r.phrase)
    if (r.handling !== 'fast') { expect(p).toBeNull(); return }
    expect(p).not.toBeNull()
    if (r.action === 'quote.one' || r.action === 'quote.many') {
      expect(p.intent).toBe('quote')
      expect(p.symbols).toEqual(r.syms)
      expect(p.symbols.length > 1).toBe(r.action === 'quote.many')
    } else {
      expect(p.intent).toBe(r.action)
      expect([p.symbol]).toEqual(r.syms)
      if (r.n != null) expect(p.n).toBe(r.n)
    }
  })

  it('a discriminator: the table is not one answer', () => {
    const kinds = new Set(ROWS.map(r => (r.handling === 'fast' ? r.action : 'null')))
    expect(kinds.size).toBeGreaterThanOrEqual(5)
  })

  it('ambiguous words: $ or UPPERCASE only', () => {
    expect(tickersOf('can you get me the price of amd')).toEqual(['AMD'])
    expect(tickersOf("what's NOW trading at")).toEqual(['NOW'])
    expect(tickersOf("what's now trading at")).toEqual([])
    expect(tickersOf('$low price')).toEqual(['LOW'])
    expect(tickersOf('is it up')).toEqual([])
  })

  it.each(['show me nvda at 5 minutes', 'add rsi to nvda', 'switch to amd', 'nvda at 3pm', 'zoom nvda in',
    'put NVDA on my watchlist', 'what is a stock', 'hi', '', 'NVDA AMD TSLA', 'a b c d e f g price',
    'nvda, amd, tsla, meta, msft, googl price'])('never claims "%s"', (s) => {
    const p = parsePriceSentence(s)
    expect(p === null || p.intent !== 'quote' || p.symbols.length <= 5).toBe(true)
    if (/minutes|rsi|switch|3pm|zoom|watchlist|^what is|^hi$|^$|NVDA AMD TSLA|googl price/.test(s)) expect(p).toBeNull()
  })
})

// ── answers, per session state ────────────────────────────────────────────────────────────────────────────────────
const FETCHED = '2026-11-02T15:31:10Z'            // Mon Nov 2 2026, 10:31 AM ET
const row = (o = {}) => ({ symbol: 'NVDA', last: 142.1, last_source: 'trade', change: 1.23, change_pct: 0.87,
  open: 141, high: 143, low: 140.5, day_close: 142.1, volume: 1000, prev_close: 140.87, as_of: '2026-11-02T15:31:05Z', ...o })
const env = (o = {}, data = {}) => ({ contract: 'MD-1.0', kind: 'quote', params_echo: { symbol: 'NVDA' }, status: 'ok',
  freshness: 'live', as_of: '2026-11-02T15:31:05Z', fetched_at: FETCHED, delay_s: null, stale: false, source: 'massive',
  coverage: null, provider_calls: 1, notes: [], data: { quote: row(data.row), session: 'regular', session_detail: 'regular', ...data.d }, ...o })

const LIVE_WORDS = /\b(live|now|right now|real-time price\b(?! *[:—,]))/i
const says = (a) => (typeof a === 'string' ? a : a.text)

describe('stock.quote answers state the session, as-of and freshness honestly', () => {
  it('regular, fresh: live, price, change, session, as-of', () => {
    const t = says(answerFromEnvelope(env(), ['NVDA']))
    expect(t).toContain('NVDA $142.10, +$1.23 (+0.87%) vs the previous close — live, regular session, as of 10:31 AM ET.')
  })

  it('regular, stale: says stale and never live', () => {
    const t = says(answerFromEnvelope(env({ stale: true }, { row: { as_of: '2026-11-02T15:20:00Z' } }), ['NVDA']))
    expect(t).toMatch(/stale, not a real-time price: the latest trade is from 10:20 AM ET/)
    expect(t).not.toMatch(/\blive\b/)
  })

  it('premarket inside the 15-minute window: live, extended hours, thin trading', () => {
    const e = env({ as_of: '2026-11-02T12:45:00Z', fetched_at: '2026-11-02T12:45:30Z' },
      { row: { as_of: '2026-11-02T12:45:00Z' }, d: { session: 'extended', session_detail: 'premarket' } })
    expect(says(answerFromEnvelope(e, ['NVDA']))).toContain('NVDA $142.10 in premarket trading, +$1.23 (+0.87%) vs the previous close — live, extended hours (thin trading), as of 7:45 AM ET.')
  })

  it('after hours past the window: the last extended print, not live', () => {
    const e = env({ freshness: 'historical', as_of: '2026-11-02T21:30:00Z', fetched_at: '2026-11-02T22:10:00Z' },
      { row: { as_of: '2026-11-02T21:30:00Z' }, d: { session: 'extended', session_detail: 'after-hours' } })
    const t = says(answerFromEnvelope(e, ['NVDA']))
    expect(t).toContain('NVDA last traded $142.10 at 4:30 PM ET (after hours, no trade in the last 15 minutes)')
    expect(t).toContain('Not a real-time price.')
    expect(t).not.toMatch(/\blive\b|\bnow\b/)
  })

  it.each([['overnight', 'overnight'], ['closed', 'weekend or holiday']])('%s: "Market closed (…): last close $X (date)", never live', (detail, word) => {
    const e = env({ freshness: 'historical', as_of: '2026-10-30T20:00:00Z', fetched_at: '2026-10-31T15:00:00Z' },
      { row: { last_source: 'day_close', as_of: '2026-10-30T20:00:00Z' }, d: { session: 'closed', session_detail: detail } })
    const t = says(answerFromEnvelope(e, ['NVDA']))
    expect(t).toContain(`Market closed (${word}): NVDA last close $142.10 (Fri, Oct 30)`)
    expect(t).not.toMatch(/\blive\b|\bnow\b/)
  })

  it('closed with an after-hours print says "last trade", with its time', () => {
    const e = env({ freshness: 'historical', as_of: '2026-10-30T23:59:00Z', fetched_at: '2026-10-31T15:00:00Z' },
      { row: { last_source: 'trade', as_of: '2026-10-30T23:59:00Z' }, d: { session: 'closed', session_detail: 'closed' } })
    expect(says(answerFromEnvelope(e, ['NVDA']))).toContain('Market closed (weekend or holiday): NVDA last trade $142.10 (Fri, Oct 30, 7:59 PM ET)')
  })

  it('regular session, row priced from a close (partial): says so', () => {
    const e = env({ status: 'partial' }, { row: { last_source: 'day_close' } })
    const t = says(answerFromEnvelope(e, ['NVDA']))
    expect(t).toContain("NVDA: no current trade in the regular session — showing the day's close, $142.10")
    expect(t).not.toMatch(/\blive\b/)
  })

  it('quotes, partial: one line per symbol, names the missing one, one Source line', () => {
    const e = { ...env({ kind: 'quotes', status: 'partial' }), data: { quotes: [row(), row({ symbol: 'AMD', last: 160.5, change: -2, change_pct: -1.23 })], session: 'regular', session_detail: 'regular' } }
    const t = says(answerFromEnvelope(e, ['NVDA', 'AMD', 'NOPE']))
    expect(t.split('\n')).toEqual([
      'NVDA $142.10, +$1.23 (+0.87%) vs the previous close — live, regular session, as of 10:31 AM ET.',
      'AMD $160.50, −$2.00 (−1.23%) vs the previous close — live, regular session, as of 10:31 AM ET.',
      'Partial: no price for NOPE.',
      'Source: Massive market snapshot through the UCT data gateway.',
    ])
  })

  it.each([
    ['refused', "I couldn't get a price for NVDA: that request wasn't allowed for this question, so I didn't read a price. No price is stated."],
    ['unavailable', "I couldn't get a price for NVDA: UCT's market data didn't return a price for it. No price is stated."],
  ])('%s: fixed words, no number at all, never the envelope note (F-20)', (status, want) => {
    for (const note of ['this turn already made 8 data reads (the limit is 8)', 'the quote provider could not answer', '']) {
      const t = says(answerFromEnvelope({ ...env({ status, freshness: 'unavailable', as_of: null }), data: null, notes: note ? [note] : [] }, ['NVDA']))
      expect(t).toBe(want)
      expect(t).not.toMatch(/\d/)
      expect(t).not.toMatch(/\b(live|now)\b/)
    }
  })

  it('an unknown status with no rows is the unavailable sentence, and an ok read with no priced row too', () => {
    const want = "I couldn't get a price for NVDA: UCT's market data didn't return a price for it. No price is stated."
    expect(says(answerFromEnvelope({ ...env({ status: 'weird' }), notes: ['9 9 9'] }, ['NVDA']))).toBe(want)
    expect(says(answerFromEnvelope({ ...env(), data: { quote: { symbol: 'NVDA', last: null } }, notes: ['8 reads'] }, ['NVDA']))).toBe(want)
  })

  it('only the text and labelled figures leave the module — never the envelope', () => {
    for (const e of [env(), env({ stale: true }), { ...env({ status: 'refused' }), data: null, notes: ['x'] }]) {
      const out = answerFromEnvelope(e, ['NVDA'])
      expect(Object.keys(out).every(k => ['text', 'present'].includes(k))).toBe(true)
      const s = JSON.stringify(out)
      for (const leak of ['provider_calls', 'params_echo', 'contract', 'MD-1.0', 'last_source', 'fetched_at', 'session_detail', 'coverage']) expect(s).not.toContain(leak)
    }
  })

  it('"live" is used only by a fresh live row', () => {
    const cases = [env(), env({ stale: true }), env({ freshness: 'historical' }, { d: { session_detail: 'overnight' } }),
      env({ freshness: 'historical' }, { d: { session_detail: 'after-hours' } }), env({ status: 'partial' }, { row: { last_source: 'prev_close' } })]
    for (const e of cases) {
      const r = describeRow(e, e.data.quote)
      const live = e.freshness === 'live' && !e.stale && ['trade', 'minute'].includes(e.data.quote.last_source)
      expect(/\blive\b/.test(r.line)).toBe(live)
      expect(r.fresh === 'live').toBe(live)
    }
  })
})

// ── the gateway seam: flags off is stock.profile, byte for byte; on is one MD-1 read, never /api/live-prices ─────
const PROFILE = { name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors', price: 140, market_cap: 3.4e12,
  pe_trailing: 55.1, pe_forward: 33.2, fifty_two_week_low: 90, fifty_two_week_high: 160, beta: 1.7, total_revenue: 1.3e11 }
function wire({ data }) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data, scan: false })
    if (u.startsWith('/api/fundamentals-full/')) return json(PROFILE)
    if (u.startsWith('/api/live-prices')) return json({ NVDA: { price: 142.1, change_pct: 0.87, observed_at: 1793640665 } })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      return json(b.kind === 'quote' ? env() : { ...env({ kind: 'quotes' }), data: { quotes: b.params.symbols.map(s => row({ symbol: s })), session: 'regular', session_detail: 'regular' } })
    }
    return json({}, 404)
  })
}

describe('stock.quote: flags off is exactly stock.profile; on is one gateway read', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't1'; KINDS = ['quote', 'quotes'] })

  it('flags off: same bytes as stock.profile, no gateway POST, nothing registered, no fast-path claim', async () => {
    wire({ data: false })
    await loadAgentConfig()
    const mine = await answerQuote({ symbols: ['NVDA'] })
    const theirs = await answerProfile({ symbol: 'NVDA' })
    expect(JSON.stringify(mine)).toBe(JSON.stringify(theirs))
    expect(globalThis.fetch.mock.calls.map(c => c[0])).not.toContain('/api/agent/data')
    expect(registerMarketDataCapabilities()).toBe(false)
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(match("what's NVDA trading at premarket?")).toBeNull()
  })

  it('on: one `quote` read for one symbol, one `quotes` read for several, never /api/live-prices', async () => {
    wire({ data: true })
    await loadAgentConfig()
    const one = await answerQuote({ symbols: ['nvda'] })
    expect(one.text).toContain('NVDA $142.10')
    TURN = 't2'
    await answerQuote({ symbols: ['NVDA', '$amd'] })
    const posts = globalThis.fetch.mock.calls.filter(c => c[0] === '/api/agent/data').map(c => JSON.parse(c[1].body))
    expect(posts).toEqual([
      { kind: 'quote', params: { symbol: 'NVDA' }, purpose: 'answer', turn_id: 't1' },
      { kind: 'quotes', params: { symbols: ['NVDA', 'AMD'] }, purpose: 'answer', turn_id: 't2' },
    ])
    expect(globalThis.fetch.mock.calls.some(c => String(c[0]).startsWith('/api/live-prices'))).toBe(false)
  })

  it('on: match() claims price phrasings only, and registration is idempotent', async () => {
    wire({ data: true })
    await loadAgentConfig()
    expect(match("what's NVDA trading at premarket?")).toEqual({ action: CAPABILITY, params: { symbols: ['NVDA'] } })
    expect(match('NVDA and AMD premarket')).toEqual({ action: CAPABILITY, params: { symbols: ['NVDA', 'AMD'] } })
    expect(match('how did AAPL close yesterday')).toBeNull()        // bars: marketDataBars.js (PR C)
    expect(match('why is nvda up')).toBeNull()
    expect(registerMarketDataCapabilities()).toBe(true)
    expect(registerMarketDataCapabilities()).toBe(false)
    expect(allCapabilityNames()).toContain(CAPABILITY)
  })

  it.each([[null, 'an older server with no data_kinds'], [[], 'nothing activated'], [['bars.daily'], 'quote not activated'],
    [['quote'], 'quotes not activated']])('data on but kinds %j (%s): still exactly stock.profile', async (kinds) => {
    KINDS = kinds
    wire({ data: true })
    await loadAgentConfig()
    const mine = await answerQuote({ symbols: ['NVDA'] })
    expect(JSON.stringify(mine)).toBe(JSON.stringify(await answerProfile({ symbol: 'NVDA' })))
    expect(globalThis.fetch.mock.calls.map(c => c[0])).not.toContain('/api/agent/data')
    expect(match('nvda price')).toBeNull()
    expect(registerMarketDataCapabilities()).toBe(false)
  })

  it('on, no turn id: no read, a plain sentence', async () => {
    wire({ data: true })
    await loadAgentConfig()
    TURN = null
    const t = await answerQuote({ symbols: ['NVDA'] })
    expect(t).toMatch(/needs the Agent's turn/)
    expect(globalThis.fetch.mock.calls.map(c => c[0])).not.toContain('/api/agent/data')
  })
})
