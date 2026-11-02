// stock.quote (Sprint 2 B, owner agent-md): the phrase parser is held to docs/agent/program/contracts/MD-1-phrasings.md
// ROW BY ROW (the doc is parsed, not restated), every session state answers honestly, nothing envelope-shaped reaches
// the output, and with the data gateway off everything is exactly stock.profile.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { match, answerQuote, answerFromEnvelope, describeRow, registerMarketDataCapabilities, _resetForTest, CAPABILITY } from './capabilities/marketDataQuote'
import { answerProfile } from './capabilities/stock'
import { allCapabilityNames } from './capabilities'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'

// the turn id comes from trace.js only (agent-qa's readDataTurnId rail); the tests set it there
let TURN = 't1'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
// agent-lead #621's per-kind activation, sent as /api/agent/config `data_kinds` (null = an older server: no key)
let KINDS = null

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

// The MD-1-phrasings rows (intent, candidates and outcome) are held in agentDataResolve.test.js since MD-1 §4.7.

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
    ['refused', "I couldn't get a price for NVDA: that request wasn't allowed for this question, so the price is not available. No price is stated."],
    ['unavailable', "I couldn't get a price for NVDA: the price is not available from UCT's market data. No price is stated."],
  ])('%s: fixed words, no number at all, never the envelope note (F-20)', (status, want) => {
    for (const note of ['this turn already made 8 data reads (the limit is 8)', 'the quote provider could not answer', '']) {
      const t = says(answerFromEnvelope({ ...env({ status, freshness: 'unavailable', as_of: null }), data: null, notes: note ? [note] : [] }, ['NVDA']))
      expect(t).toBe(want)
      expect(t).not.toMatch(/\d/)
      expect(t).not.toMatch(/\b(live|now)\b/)
    }
  })

  it('an unknown status with no rows is the unavailable sentence, and an ok read with no priced row too', () => {
    const want = "I couldn't get a price for NVDA: the price is not available from UCT's market data. No price is stated."
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
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data, scan: false, ...(KINDS ? { data_kinds: KINDS } : {}) })
    if (u.startsWith('/api/fundamentals-full/')) return json(PROFILE)
    if (u.startsWith('/api/live-prices')) return json({ NVDA: { price: 142.1, change_pct: 0.87, observed_at: 1793640665 } })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      if (b.kind === 'instrument.resolve') return json(resolveEnvelope(b.params))
      return json(b.kind === 'quote' ? env() : { ...env({ kind: 'quotes' }), data: { quotes: b.params.symbols.map(s => row({ symbol: s })), session: 'regular', session_detail: 'regular' } })
    }
    return json({}, 404)
  })
}

describe('stock.quote: flags off is exactly stock.profile; on is one gateway read', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't1'; KINDS = ['instrument.resolve', 'quote', 'quotes'] })

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
    const one = await answerQuote({ symbols: ['NVDA'] })
    expect(one.text).toContain('NVDA (NVIDIA Corporation) $142.10')
    TURN = 't2'
    const two = await answerQuote({ symbols: ['NVDA', '$amd'] })
    expect(two.text).toContain('AMD (Advanced Micro Devices, Inc.)')
    TURN = 't3'
    expect(await answerQuote({ symbols: ['nvda'] })).toBe("Did you mean NVDA (NVIDIA Corporation)? Type the ticker in capitals, like NVDA, and I'll get it.")
    const posts = globalThis.fetch.mock.calls.filter(c => c[0] === '/api/agent/data').map(c => JSON.parse(c[1].body))
    expect(posts.map(p => [p.kind, p.turn_id])).toEqual([
      ['instrument.resolve', 't1'], ['quote', 't1'],
      ['instrument.resolve', 't2'], ['quotes', 't2'],
      ['instrument.resolve', 't3'],                                  // lowercase: asked, never priced
    ])
    expect(posts[1].params).toEqual({ symbol: 'NVDA' })
    expect(posts[2].params).toEqual({ symbols: [{ text: 'NVDA', form: 'upper' }, { text: '$amd', form: 'cashtag' }] })
    expect(posts[3].params).toEqual({ symbols: ['NVDA', 'AMD'] })
    expect(globalThis.fetch.mock.calls.some(c => String(c[0]).startsWith('/api/live-prices'))).toBe(false)
  })

  it('on: match() claims price phrasings only, and registration is idempotent', async () => {
    wire({ data: true })
    await loadAgentConfig()
    expect(match("what's NVDA trading at premarket?")).toEqual({ action: CAPABILITY, params: { symbols: ['NVDA'] } })
    expect(match('NVDA and AMD premarket')).toEqual({ action: CAPABILITY, params: { symbols: ['NVDA', 'AMD'] } })
    expect(match('nvda price')).toEqual({ action: CAPABILITY, params: { symbols: ['nvda'] } })   // as typed: resolve decides
    expect(match('AAPL close')).toBeNull()                          // bars: marketDataBars.js
    expect(match('how did AAPL close yesterday')).toBeNull()        // a day the parser cannot resolve
    expect(match('why is nvda up')).toBeNull()
    expect(registerMarketDataCapabilities()).toBe(true)
    expect(registerMarketDataCapabilities()).toBe(false)
    expect(allCapabilityNames()).toContain(CAPABILITY)
  })

  it.each([[null, 'an older server with no data_kinds'], [[], 'nothing activated'], [['bars.daily'], 'quote not activated'],
    [['quote'], 'quotes not activated'], [['quote', 'quotes'], 'instrument.resolve not activated'],
    [['instrument.resolve', 'bars.daily'], 'only bars']])('data on but kinds %j (%s): still exactly stock.profile', async (kinds) => {
    KINDS = kinds
    wire({ data: true })
    await loadAgentConfig()
    const mine = await answerQuote({ symbols: ['NVDA'] })
    expect(JSON.stringify(mine)).toBe(JSON.stringify(await answerProfile({ symbol: 'NVDA' })))
    expect(globalThis.fetch.mock.calls.map(c => c[0])).not.toContain('/api/agent/data')
    expect(match('nvda price')).toBeNull()
    registerMarketDataCapabilities()                              // may register stock.dailyBars (bars.daily on)…
    expect(allCapabilityNames()).not.toContain(CAPABILITY)        // …but never stock.quote
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
