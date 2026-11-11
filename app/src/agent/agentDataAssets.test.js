// W1-C C-03 (builder-c): index / commodity / crypto questions through the dedicated kinds. A lowercase "gold", "btc",
// "s&p" keeps its §4.7 class on the server; the resolve read ADDS a route, and ONLY while the routed kind is served does
// the answer become one read of that kind — the honest decline today, a figure once a licensed source lands. With the
// kinds not served (the default, and every held-out QA set), the §4.7.3 sentence stands unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { answerQuote, _resetForTest } from './capabilities/marketDataQuote'
import { decide, clarifyText } from './capabilities/marketDataResolve'
import { servedRoute, answerFromAsset, declineText, answerAssetRoute } from './capabilities/marketDataAssets'

const FETCHED = '2026-11-02T15:30:05Z'
const shell = (kind, params, over = {}) => ({ contract: 'MD-1.0', kind, params_echo: params, status: 'ok', freshness: 'periodic', as_of: '2026-11-02T06:00:00Z',
  fetched_at: FETCHED, delay_s: null, stale: false, source: 'uct-symbol-index', coverage: null, data: null, notes: ['never echoed'], provider_calls: 0, ...over })
const res = (input, form, klass, extra = {}) => ({ input, form, class: klass, symbol: null, name: null, type: null, candidate: null, basis: null, ...extra })
const ROUTES = {
  gold: { kind: 'commodity.quote', asset: 'gold', label: 'gold' }, btc: { kind: 'crypto.quote', asset: 'btc', label: 'Bitcoin' },
  's&p': { kind: 'index.quote', asset: 'spx', label: 'S&P 500' }, spx: { kind: 'index.quote', asset: 'spx', label: 'S&P 500' },
}
const CLASS = { gold: 'symbol_typed_lowercase', btc: 'symbol_typed_lowercase', 's&p': 'unknown', spx: 'non_equity', nvda: 'symbol', NVDA: 'symbol' }
function resolveEnvelope(params) {
  const results = params.symbols.map(c => res(c.text, c.form, CLASS[c.text] || 'unknown', CLASS[c.text] === 'symbol' ? { symbol: c.text.toUpperCase(), name: 'NVIDIA Corporation', type: 'stock' } : {}))
  const routes = params.symbols.map(c => (c.form === 'upper' && CLASS[c.text] === 'symbol' ? null : ROUTES[c.text] || null))
  return shell('instrument.resolve', params, { data: { results, routes, all_symbols: results.every(r => r.class === 'symbol') } })
}
const decline = (kind, params) => shell(kind, params, { status: 'refused', freshness: 'unavailable', as_of: null, source: `uct-agent-${kind}`, notes: ["I don't have a licensed source for commodity prices, so no figure is stated"] })
const served = (kind, params) => shell(kind, params, { freshness: 'delayed', delay_s: 900, as_of: '2026-11-02T15:30:00Z', source: 'massive', provider_calls: 1,
  data: { asset: params.asset, label: 'S&P 500', value: 6812.34, change: 27.1, change_pct: 0.4, previous_close: 6785.24, unit: null, as_of: '2026-11-02T15:30:00Z' } })

let KINDS, posts, assetAnswer
function wire() {
  posts = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: true, scan: false, data_kinds: KINDS })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); posts.push(b)
      if (b.kind === 'instrument.resolve') return json(resolveEnvelope(b.params))
      if (['index.quote', 'commodity.quote', 'crypto.quote'].includes(b.kind)) return json(assetAnswer(b.kind, b.params))
      return json(shell(b.kind, b.params, { status: 'unavailable', freshness: 'unavailable', as_of: null, notes: ['no'] }))
    }
    throw new Error(`unexpected fetch ${u}`)
  })
}
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }

describe('decide(): the route is taken only while its kind is served', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetForTest(); vi.restoreAllMocks() })
  it('not served: the neutral §4.7.3 ask / limit sentence, exactly as before, and no route', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes']; wire(); await loadAgentConfig()
    const cands = [{ text: 'gold', form: 'lower' }]
    const d = decide(resolveEnvelope({ symbols: cands }), cands)
    expect(d).toEqual({ ok: false, text: clarifyText('gold') })
    const sp = [{ text: 's&p', form: 'lower' }]
    expect(decide(resolveEnvelope({ symbols: sp }), sp)).toEqual({ ok: false, text: "I can quote US-listed stocks and ETFs by ticker. s&p isn't one I can price here." })
  })
  it('served: the route rides along with the sentence; servedRoute picks the first served one', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes', 'commodity.quote']; wire(); await loadAgentConfig()
    const cands = [{ text: 'NVDA', form: 'upper' }, { text: 'btc', form: 'lower' }, { text: 'gold', form: 'lower' }]
    const e = resolveEnvelope({ symbols: cands })
    expect(servedRoute(e, e.data.results)).toEqual({ kind: 'commodity.quote', asset: 'gold', label: 'gold', word: 'gold' })   // btc's kind is not served
    const d = decide(e, cands)
    expect(d.ok).toBe(false)
    expect(d.text).toBe(clarifyText('btc'))                                 // the sentence is unchanged (bars still uses it)
    expect(d.route).toEqual({ kind: 'commodity.quote', asset: 'gold', label: 'gold', word: 'gold' })
  })
  it('all symbols: no route is ever attached to a priced read', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes', 'commodity.quote', 'crypto.quote', 'index.quote']; wire(); await loadAgentConfig()
    const cands = [{ text: 'NVDA', form: 'upper' }]
    expect(decide(resolveEnvelope({ symbols: cands }), cands)).toEqual({ ok: true, symbols: ['NVDA'], names: { NVDA: 'NVIDIA Corporation' } })
  })
})

describe('answerQuote with a served route: one read of the routed kind, never a ticker guess', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetForTest(); vi.restoreAllMocks(); assetAnswer = decline })
  afterEach(() => _resetTurns())
  it('the honest decline, in fixed words, with no number and no quote/quotes read', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes', 'commodity.quote']; wire(); await loadAgentConfig()
    const a = await inTurn(() => answerQuote({ symbols: ['gold'] }))
    expect(a.text).toBe("I don't have a licensed source for commodity prices, so I can't price gold. No price is stated.")
    expect(posts.map(p => p.kind)).toEqual(['instrument.resolve', 'commodity.quote'])
    expect(posts[1]).toMatchObject({ params: { asset: 'gold' }, purpose: 'answer' })
    expect(posts[1].turn_id).toMatch(/^t-/)
    expect(JSON.stringify(a)).not.toMatch(/never echoed|no figure is stated/)
  })
  it('a served kind answers with the level, its delay and its time — never "live" for a delayed read', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes', 'index.quote']; wire(); await loadAgentConfig(); assetAnswer = served
    const a = await inTurn(() => answerQuote({ symbols: ['s&p'] }))
    expect(a.text).toMatch(/^S&P 500 6,812\.34, \+0\.40% vs the previous close — delayed 15 minutes, as of Mon, Nov 2, 10:30 AM ET\./)
    expect(a.text).not.toMatch(/\blive\b/)
    expect(a.present.items[0]).toMatchObject({ label: 'Level', value: '6,812.34' })
    expect(posts.map(p => p.kind)).toEqual(['instrument.resolve', 'index.quote'])
  })
  it('the kind not served: exactly the old sentence, no asset read', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes']; wire(); await loadAgentConfig()
    expect(await inTurn(() => answerQuote({ symbols: ['gold'] }))).toBe(clarifyText('gold'))
    expect(await inTurn(() => answerQuote({ symbols: ['spx'] }))).toBe("I can quote US-listed stocks and ETFs by ticker. spx isn't one I can price here.")
    expect(posts.map(p => p.kind)).toEqual(['instrument.resolve', 'instrument.resolve'])
  })
  it('an explicit ticker is the member\'s choice: GOLD / $BTC price the stock or fund, with the fund labelled', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes', 'commodity.quote', 'crypto.quote']; wire(); await loadAgentConfig()
    await inTurn(() => answerQuote({ symbols: ['NVDA'] }))
    expect(posts.map(p => p.kind)).toEqual(['instrument.resolve', 'quote'])      // priced as typed; no asset kind read
  })
  it('pure: answerFromAsset declines on anything but a usable value; a live fresh read may say live; stale is said', () => {
    const route = { kind: 'crypto.quote', asset: 'btc', label: 'Bitcoin', word: 'btc' }
    expect(answerFromAsset(decline('crypto.quote', {}), route).text).toBe(declineText(route))
    expect(answerFromAsset({ ...served('crypto.quote', { asset: 'btc' }), freshness: 'live', delay_s: null, data: { value: 68000, change_pct: -1.25, as_of: '2026-11-02T15:30:00Z' } }, route).text)
      .toMatch(/^Bitcoin \$68,000\.00, −1\.25% vs the previous close — live, as of Mon, Nov 2, 10:30 AM ET\./)
    expect(answerFromAsset({ ...served('crypto.quote', { asset: 'btc' }), freshness: 'live', stale: true, data: { value: 68000 } }, route).text).toMatch(/not a real-time figure.*This reading is stale\./)
  })
  it('served but no open turn: a plain sentence, no read', async () => {
    KINDS = ['instrument.resolve', 'quote', 'quotes', 'commodity.quote']; wire(); await loadAgentConfig()
    expect(await answerAssetRoute({ kind: 'commodity.quote', asset: 'gold', label: 'gold', word: 'gold' })).toBe("I couldn't read that: this needs the Agent's turn, which wasn't available.")
    expect(posts).toEqual([])
  })
})
