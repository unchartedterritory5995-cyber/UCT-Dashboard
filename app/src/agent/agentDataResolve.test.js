// MD-1 §4.7 on the client (owner agent-md): every row of docs/agent/program/contracts/MD-1-phrasings.md §3 — read from
// the doc — goes through the REAL fast path (every builtin registered) and the REAL capability answer, with the
// gateway answering `instrument.resolve` from the shared fixture index (marketdata/__fixtures__/symbol-index.json, the
// same rows the server test holds instruments.py to). Outcome = price | bars | ask:SYM | limit | model, as written.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { getCapability, allCapabilityNames } from './capabilities'
import { parsePriceSentence } from './capabilities/marketDataPhrases'
import { registerMarketDataCapabilities, _resetForTest, CAPABILITY as QUOTE } from './capabilities/marketDataQuote'
import { CAPABILITY as BARS, answerFromBars } from './capabilities/marketDataBars'
import { decide, NOT_READY, FUND_NOTE, clarifyText } from './capabilities/marketDataResolve'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import INDEX from './marketdata/__fixtures__/symbol-index.json'

let TURN = 't-r'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

const here = dirname(fileURLToPath(import.meta.url))
const DOC = readFileSync(resolve(here, '../../../docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const ROWS = DOC.split('\n').filter(l => /^\| P\d\d \|/.test(l)).map(l => {
  const c = l.split('|').map(s => s.trim())
  const cands = c[4] === '—' ? [] : [...c[4].matchAll(/`([^`]+)`/g)][0][1].split(' ').map(t => {
    const i = t.lastIndexOf(':')
    return { text: t.slice(0, i), form: t.slice(i + 1) }
  })
  const intent = c[3].split(' ')[0]
  const n = (c[3].match(/n=(\d+)/) || [])[1]
  return { id: c[1], phrase: c[2], intent, n: n ? Number(n) : null, cands, outcome: c[5] }
})
const NAMES = Object.fromEntries(INDEX.rows.map(([s, n]) => [s, n]))
const TYPES = Object.fromEntries(INDEX.rows.map(([s, , t]) => [s, t]))
const ALL_KINDS = ['instrument.resolve', 'quote', 'quotes', 'bars.daily']
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

function quoteEnv(symbols) {
  const rows = symbols.map(s => ({ symbol: s, last: 100, last_source: 'trade', change: 1, change_pct: 1, as_of: '2026-11-02T15:31:05Z' }))
  return { contract: 'MD-1.0', kind: symbols.length > 1 ? 'quotes' : 'quote', params_echo: {}, status: 'ok', freshness: 'live',
    as_of: '2026-11-02T15:31:05Z', fetched_at: '2026-11-02T15:31:10Z', delay_s: null, stale: false, source: 'massive',
    coverage: null, provider_calls: 1, notes: [],
    data: { ...(symbols.length > 1 ? { quotes: rows } : { quote: rows[0] }), session: 'regular', session_detail: 'regular' } }
}
function barsEnv(symbol, n) {
  const bars = Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(1 + i).padStart(2, '0')}`, open: 1, high: 2, low: 0.5, close: 1 + i, volume: 1 }))
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2026-10-30T20:00:00Z',
    fetched_at: '2026-11-02T15:31:10Z', delay_s: null, stale: false, source: 'uct-bars', coverage: null, provider_calls: 0,
    notes: [], data: { symbol, bars, through: bars[bars.length - 1].date, latest_completed_session: bars[bars.length - 1].date } }
}
function wire({ data = true, kinds = ALL_KINDS, ready = true } = {}) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data, scan: false, ...(kinds ? { data_kinds: kinds } : {}) })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      if (b.kind === 'instrument.resolve') return json(resolveEnvelope(b.params, { ready }))
      if (b.kind === 'quote') return json(quoteEnv([b.params.symbol]))
      if (b.kind === 'quotes') return json(quoteEnv(b.params.symbols))
      if (b.kind === 'bars.daily') return json(barsEnv(b.params.symbol, Math.min(b.params.bars, 30)))
    }
    return json({}, 404)
  })
}
const posts = () => globalThis.fetch.mock.calls.filter(c => c[0] === '/api/agent/data').map(c => JSON.parse(c[1].body))
const says = (a) => (typeof a === 'string' ? a : a.text)

describe('MD-1-phrasings §3 (read from the doc): intent and candidates', () => {
  it('has P01–P42, and every outcome kind appears', () => {
    expect(ROWS.map(r => r.id)).toEqual(Array.from({ length: 42 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`))
    const kinds = new Set(ROWS.map(r => r.outcome.split(':')[0]))
    expect(kinds).toEqual(new Set(['price', 'bars', 'ask', 'limit', 'model']))
  })

  it.each(ROWS)('$id "$phrase" → $intent', (r) => {
    const p = parsePriceSentence(r.phrase)
    if (r.intent === 'none') { expect(p).toBeNull(); return }
    expect(p?.intent).toBe(r.intent)
    expect(p.candidates).toEqual(r.cands)
    if (r.n != null) expect(p.n).toBe(r.n)
  })
})

describe('MD-1 §4.7.1: a time the parser cannot resolve without a clock is never a current quote or "the last session"', () => {
  // each of these is otherwise a clean, claimable shape (grammar words + resolvable symbols): only the time veto stops it
  it.each(['NVDA price last week', 'NVDA and AMD price last week', 'AAPL close last week', 'NVDA price this month',
    'NVDA 5-day change last year', 'NVDA price on 10/30', 'NVDA price 2025-10-30', 'NVDA price all time',
    'NVDA price ytd', "NVDA's high today", 'NVDA price history', 'TSLA close yesterday', 'NVDA price friday',
    'NVDA price in october', 'NVDA price since 2024', 'NVDA price 3 days ago'])('"%s" → not claimed', (s) => {
    expect(parsePriceSentence(s)).toBeNull()
  })
  it('control: the same shapes without the time words ARE claimed', () => {
    for (const s of ['NVDA price', 'NVDA and AMD price', 'AAPL close', "NVDA's 5-day change"]) expect(parsePriceSentence(s)).not.toBeNull()
  })
})

describe('MD-1 §4.7: each row ends exactly as the doc says, through the real fast path and answer', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't-r' })

  it.each(ROWS)('$id "$phrase" → $outcome', async (r) => {
    wire()
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const f = fastParse(r.phrase, {})
    const ours = f?.ops?.filter(o => o.action === QUOTE || o.action === BARS) || []
    if (r.outcome === 'model') {
      expect(ours).toEqual([])
      expect(posts()).toEqual([])
      return
    }
    expect(f.ops.map(o => o.action)).toEqual([r.intent === 'quote' ? QUOTE : BARS])   // the sole claimant
    const text = says(await getCapability(f.ops[0].action).answer(null, f.ops[0].args))
    const reads = posts().map(p => p.kind)
    expect(reads[0]).toBe('instrument.resolve')                                          // resolve comes first, always
    const [kind, sym] = r.outcome.split(':')
    if (kind === 'price' || kind === 'bars') {
      expect(reads.length).toBe(2)
      expect(reads[1]).toMatch(kind === 'price' ? /^quotes?$/ : /^bars\.daily$/)
      const priced = kind === 'bars' ? [posts()[1].params.symbol] : (posts()[1].params.symbols || [posts()[1].params.symbol])
      for (const s of priced) {
        // every priced security is named; a fund is labelled one (owner ruling 2)
        expect(text).toContain(TYPES[s] === 'etf' ? `${s} (${NAMES[s]}, an ETF)` : `${s} (${NAMES[s]})`)
      }
      // owner ruling 3: an ETF's price is never the underlying's price — said whenever one is priced, never otherwise
      if (priced.some(s => TYPES[s] === 'etf')) expect(text).toContain(FUND_NOTE)
      else expect(text).not.toContain(FUND_NOTE)
    } else {
      expect(reads).toEqual(['instrument.resolve'])                                      // nothing was priced
      expect(text).not.toMatch(/\$\d/)
      if (kind === 'ask') {
        // owner ruling 1: a NEUTRAL clarification — the word as typed, never the index's candidate security
        const typed = r.cands.find(c => c.text.toUpperCase().replace(/^\$/, '') === sym || c.form === 'lower')
        expect(text).toMatch(/^I'm not sure which instrument "[^"]+" means\. I can quote US-listed stocks and ETFs by ticker\. Type the ticker in capitals and I'll get it\.$/)
        expect(typed).toBeTruthy()
        expect(text).not.toContain(NAMES[sym])
        expect(text).not.toContain(`${sym} (`)
        expect(text).not.toMatch(/Did you mean/)
      }
      if (kind === 'limit') expect(text).toMatch(/^I can quote US-listed stocks and ETFs by ticker\. \S+ isn't one I can price here\.$/)
      expect(text).not.toMatch(/\btry\b/i)                                               // never a substitute
    }
  })
})

describe('owner ruling 3: a fund is never priced as its underlying', () => {
  it('a bars answer for an ETF names it a fund and says whose price it is; a stock answer does not', () => {
    const etf = says(answerFromBars(barsEnv('BTC', 2), { symbol: 'BTC', measure: 'lastClose', name: `${NAMES.BTC}, an ETF` }))
    expect(etf).toContain('BTC (Grayscale Bitcoin Mini Trust, an ETF) closed at')
    expect(etf).toContain(FUND_NOTE)
    const stock = says(answerFromBars(barsEnv('GOLD', 2), { symbol: 'GOLD', measure: 'lastClose', name: NAMES.GOLD }))
    expect(stock).toContain('GOLD (Barrick Gold Corporation) closed at')
    expect(stock).not.toContain(FUND_NOTE)
  })
})

describe('decide(): all or nothing, precedence, and a cold index', () => {
  const env = (cands) => resolveEnvelope({ symbols: cands })
  it('every candidate a symbol → the canonical symbols with their names', () => {
    const c = [{ text: 'NVDA', form: 'upper' }, { text: '$brk.b', form: 'cashtag' }]
    expect(decide(env(c), c)).toEqual({ ok: true, symbols: ['NVDA', 'BRK-B'], names: { NVDA: 'NVIDIA Corporation', 'BRK-B': 'Berkshire Hathaway Inc. Class B' } })
  })
  it('an explicit fund ticker resolves to the fund, labelled an ETF by the index type (owner ruling 2)', () => {
    const c = [{ text: 'BTC', form: 'upper' }, { text: 'SPY', form: 'upper' }]
    expect(decide(env(c), c)).toEqual({ ok: true, symbols: ['BTC', 'SPY'],
      names: { BTC: `${NAMES.BTC}, an ETF`, SPY: `${NAMES.SPY}, an ETF` } })
  })
  it.each(['btc', 'gold', 'apple', 'nvda'])('"%s" typed lowercase → the neutral clarification, naming no security', (w) => {
    const c = [{ text: w, form: 'lower' }]
    const d = decide(env(c), c)
    expect(d).toEqual({ ok: false, text: clarifyText(w) })
    for (const [s, n] of INDEX.rows) { expect(d.text).not.toContain(n); expect(d.text).not.toContain(`${s} (`) }
  })
  it('precedence: non_equity > unknown > name_match > symbol_typed_lowercase', () => {
    const c = (...xs) => xs.map(([text, form]) => ({ text, form }))
    expect(decide(env(c(['nvda', 'lower'], ['SPX', 'upper'])), c(['nvda', 'lower'], ['SPX', 'upper'])).text).toMatch(/SPX isn't one I can price/)
    expect(decide(env(c(['apple', 'lower'], ['nvdia', 'lower'])), c(['apple', 'lower'], ['nvdia', 'lower'])).text).toMatch(/nvdia isn't one I can price/)
    expect(decide(env(c(['nvda', 'lower'], ['apple', 'lower'])), c(['nvda', 'lower'], ['apple', 'lower'])).text).toBe(clarifyText('apple'))
  })
  it.each([[null], [{ status: 'unavailable', data: null }], [{ status: 'refused', data: null }], [{ status: 'ok', data: { results: [] } }]])(
    'no usable resolve (%j) → the fixed not-ready sentence, never a price', (e) => {
      expect(decide(e, [{ text: 'NVDA', form: 'upper' }])).toEqual({ ok: false, text: NOT_READY })
    })
})

describe('activation and the gateway budget', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't-r' })

  it.each([[['quote', 'quotes', 'bars.daily']], [['instrument.resolve']], [['instrument.resolve', 'quote']]])(
    'kinds %j: neither capability is registered and nothing is claimed', async (kinds) => {
      wire({ kinds })
      await loadAgentConfig()
      registerMarketDataCapabilities()
      expect(allCapabilityNames()).not.toContain(QUOTE)
      expect(allCapabilityNames()).not.toContain(BARS)
      expect(fastParse("what's NVDA trading at premarket?", {})?.ops?.some(o => o.action === QUOTE) ?? false).toBe(false)
    })

  it('bars only needs instrument.resolve + bars.daily; quote needs instrument.resolve + quote + quotes', async () => {
    wire({ kinds: ['instrument.resolve', 'bars.daily'] })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    expect(allCapabilityNames()).toContain(BARS)
    expect(allCapabilityNames()).not.toContain(QUOTE)
  })

  it('a cold index: the fixed sentence, and no price read', async () => {
    wire({ ready: false })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const f = fastParse("what's NVDA trading at premarket?", {})
    expect(says(await getCapability(QUOTE).answer(null, f.ops[0].args))).toBe(NOT_READY)
    expect(posts().map(p => p.kind)).toEqual(['instrument.resolve'])
  })

  it('a 5-symbol compound costs exactly 2 reads (resolve + quotes), well inside the 8-read turn budget', async () => {
    wire()
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const f = fastParse('NVDA, AMD, AAPL, MSFT and SPY price', {})
    const out = await getCapability(QUOTE).answer(null, f.ops[0].args)
    expect(posts().map(p => [p.kind, p.turn_id])).toEqual([['instrument.resolve', 't-r'], ['quotes', 't-r']])
    expect(posts()[0].params.symbols).toHaveLength(5)
    for (const s of ['NVDA', 'AMD', 'AAPL', 'MSFT']) expect(says(out)).toContain(`${s} (${NAMES[s]})`)
    expect(says(out)).toContain(`SPY (${NAMES.SPY}, an ETF)`)
    expect(says(out)).toContain(FUND_NOTE)
  })

  it('never /api/live-prices, on any row', async () => {
    wire()
    await loadAgentConfig()
    registerMarketDataCapabilities()
    for (const r of ROWS) {
      const f = fastParse(r.phrase, {})
      const op = f?.ops?.find(o => o.action === QUOTE || o.action === BARS)
      if (op) await getCapability(op.action).answer(null, op.args)
    }
    expect(globalThis.fetch.mock.calls.some(c => String(c[0]).startsWith('/api/live-prices'))).toBe(false)
  })
})
