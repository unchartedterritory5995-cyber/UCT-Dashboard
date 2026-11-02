// stock.quote on the REAL fast path (fastPath.js matchWhole), with every builtin registered (owner agent-md):
//   • served (data + data_kinds ⊇ {quote, quotes}): "what's NVDA trading at premarket" is answered with ZERO model turns
//     (one POST /api/agent/data; no /api/agent/turn, no /api/live-prices);
//   • every quote row of MD-1-phrasings.md is claimed by stock.quote ALONE among the builtins;
//   • a second capability claiming the same sentence sends it to the model (matchWhole takes exactly one hit);
//   • dark: the fast path claims nothing and nothing reaches the gateway.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { getCapability, registerCapability } from './capabilities'
import { registerMarketDataCapabilities, _resetForTest, CAPABILITY } from './capabilities/marketDataQuote'

let TURN = 't-fast'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
let KINDS = ['quote', 'quotes']

registerBuiltins()

const here = dirname(fileURLToPath(import.meta.url))
const DOC = readFileSync(resolve(here, '../../../docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const QUOTE_ROWS = DOC.split('\n').filter(l => /^\| P\d\d \|/.test(l)).map(l => l.split('|').map(s => s.trim()))
  .filter(c => c[3] === 'fast' && /`quote\.(one|many)`/.test(c[4])).map(c => ({ id: c[1], phrase: c[2] }))

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const ENV = {
  contract: 'MD-1.0', kind: 'quote', params_echo: { symbol: 'NVDA' }, status: 'ok', freshness: 'live',
  as_of: '2026-11-02T12:45:00Z', fetched_at: '2026-11-02T12:45:30Z', delay_s: null, stale: false, source: 'massive',
  coverage: null, provider_calls: 1, notes: [],
  data: { quote: { symbol: 'NVDA', last: 142.1, last_source: 'trade', change: 1.23, change_pct: 0.87, as_of: '2026-11-02T12:45:00Z' },
    session: 'extended', session_detail: 'premarket' },
}
function wire(data) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data, scan: false, ...(KINDS ? { data_kinds: KINDS } : {}) })
    if (u === '/api/agent/data') return json(ENV)
    return json({}, 404)
  })
}
const urls = () => globalThis.fetch.mock.calls.map(c => String(c[0]))

describe('stock.quote on the real fast path', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't-fast'; KINDS = ['quote', 'quotes'] })
  afterEach(() => _resetForTest())

  it('served: the Sprint 2 sentence is answered with zero model turns', async () => {
    wire(true)
    await loadAgentConfig()
    expect(registerMarketDataCapabilities()).toBe(true)
    const f = fastParse("what's NVDA trading at premarket?", {})
    expect(f).toMatchObject({ kind: 'ops', ops: [{ action: CAPABILITY, args: { symbols: ['NVDA'] } }] })
    const out = await getCapability(CAPABILITY).answer(null, f.ops[0].args)
    expect(out.text).toContain('NVDA $142.10 in premarket trading, +$1.23 (+0.87%) vs the previous close — live, extended hours (thin trading), as of 7:45 AM ET.')
    expect(urls().filter(u => u !== '/api/agent/config')).toEqual(['/api/agent/data'])   // no /api/agent/turn, no /api/live-prices
  })

  it.each(QUOTE_ROWS)('served: $id "$phrase" is claimed by stock.quote alone among the builtins', async ({ phrase }) => {
    wire(true)
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const f = fastParse(phrase, {})
    expect(f?.ops?.map(o => o.action)).toEqual([CAPABILITY])
  })

  it('a second capability claiming the same sentence sends it to the model', async () => {
    wire(true)
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const off = registerCapability({
      name: 'test.rivalQuote', target: 'market', query: true, summary: 'a rival claimant (test only)', fastWhole: true,
      fast: ({ raw }) => (/nvda/i.test(raw) ? {} : null), args: { type: 'object', properties: {}, required: [], additionalProperties: false },
      answer: () => 'rival',
    })
    try {
      expect(fastParse("what's NVDA trading at premarket?", {})).toBeNull()
      expect(fastParse('amd price', {})?.ops?.[0]?.action).toBe(CAPABILITY)   // control: an uncontested one still lands
    } finally { off() }
  })

  it.each([[false, ['quote', 'quotes']], [true, null], [true, []], [true, ['quote']]])('dark (data %s, kinds %j): no claim, no gateway call', async (data, kinds) => {
    KINDS = kinds
    wire(data)
    await loadAgentConfig()
    expect(registerMarketDataCapabilities()).toBe(false)
    const f = fastParse("what's NVDA trading at premarket?", {})
    expect(f?.ops?.some(o => o.action === CAPABILITY) ?? false).toBe(false)
    expect(urls()).not.toContain('/api/agent/data')
  })

  it('registered while served, then the server goes dark: the fast path stops claiming and nothing reaches the gateway', async () => {
    wire(true)
    await loadAgentConfig()
    expect(registerMarketDataCapabilities()).toBe(true)
    expect(fastParse('nvda price', {})?.ops?.[0]?.action).toBe(CAPABILITY)
    _resetAgentConfig()                                        // the config is re-read (a later page load / refresh)
    wire(false)
    await loadAgentConfig()
    expect(fastParse('nvda price', {})).toBeNull()           // still registered, but match() re-checks the gate
    const out = await getCapability(CAPABILITY).answer(null, { symbols: ['NVDA'] })
    expect(typeof out === 'string' ? out : out.text).not.toContain('premarket trading')   // stock.profile's path, not the gateway
    expect(urls()).not.toContain('/api/agent/data')
  })

  it('a guessed spelling is never corrected into a price read (fastCorrect: false)', async () => {
    wire(true)
    await loadAgentConfig()
    registerMarketDataCapabilities()
    expect(getCapability(CAPABILITY).fastCorrect).toBe(false)
    expect(fastParse('nvda prise', {})).toBeNull()                 // "prise" is not on the fixed typo list
  })
})
