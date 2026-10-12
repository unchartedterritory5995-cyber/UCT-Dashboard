// UCT Agent — NL Intent: pronouns are never tickers (N1-safety) · grounded tickers (N4).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { isPronounToken } from './nl/tickers'
import { newChartTicker } from './capabilities/workspace'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }]
const board = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }], { A: 'NVDA' }, { watchlists: LISTS })
const ops = (text) => { const f = fastParse(text, { host: board().host }); return f?.kind === 'ops' ? f.ops.map(o => [o.action, o.args]) : f }

describe('pronouns are never tickers', () => {
  it.each([
    ['it', 'add it to momentum', true], ['It', 'It goes in Momentum', true], ['them', 'add them', true],
    ['IT', 'ADD IT TO MOMENTUM', true],                       // all capitals: capitals mark nothing
    ['IT', 'add IT to Momentum', false],                      // capitals inside a lowercase message: a ticker
    ['$it', 'add $it to momentum', false], ['$IT', 'add $IT', false],
    ['NVDA', 'add NVDA', false], ['nvda', 'add nvda', false], ['ALL', 'add ALL to swing', false],
  ])('%s in “%s” → pronoun %s', (tok, raw, want) => expect(isPronounToken(tok, raw)).toBe(want))

  it('“add it to momentum” no longer adds the symbol IT (it goes to the model, which knows what “it” is)', () => {
    expect(ops('add it to momentum')).toBeNull()
    expect(ops('Add it to Momentum.')).toBeNull()
    expect(ops('ADD IT TO MOMENTUM')).toBeNull()
    expect(ops('put that in swing')).toBeNull()
    expect(ops('add them to momentum')).toBeNull()
    expect(ops('add AMD and it to swing')).toBeNull()        // never a partial list either
    expect(ops('remove it from momentum')).toBeNull()
  })
  it('a ticker the member marked still works: $IT, IT in capitals, real tickers', () => {
    expect(ops('add $it to momentum')).toEqual([['watchlist.add', { symbols: ['IT'] }]])
    expect(ops('add IT to Momentum')).toEqual([['watchlist.add', { symbols: ['IT'] }]])
    expect(ops('add AMD and SMCI to swing')).toEqual([['watchlist.add', { symbols: ['AMD', 'SMCI'] }]])
    expect(ops('add ALL to swing')).toEqual([['watchlist.add', { symbols: ['ALL'] }]])
  })
  it('new-chart and symbol phrases follow the same rule', () => {
    expect(newChartTicker('open a chart of it')).toBeNull()
    expect(newChartTicker('OPEN A CHART OF IT')).toBeNull()
    expect(newChartTicker('open a $IT chart')).toBe('IT')
    expect(newChartTicker('open a QQQ chart')).toBe('QQQ')
    expect(ops('change the ticker to it')).toBeNull()
    expect(ops('change the ticker to $it')).toEqual([['chart.setSymbol', { symbol: 'IT' }]])
    expect(ops('$IT')).toEqual([['chart.setSymbol', { symbol: 'IT' }]])
  })
})

// ── N4: grounded tickers ──
import { groundSymbols, _resetGrounding } from './nl/tickers'
import { planOps, prepareOps, collectTargets } from './executor'
import { commitPlan } from './runtime'

const SEARCH = {
  NVDA: [{ ticker: 'NVDA', name: 'NVIDIA Corporation', type: 'stock' }, { ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA Daily ETF', type: 'etf' }],
  NVIDIA: [{ ticker: 'NVDA', name: 'NVIDIA Corporation', type: 'stock' }, { ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA Daily ETF', type: 'etf' }],
  APPLE: [{ ticker: 'AAPL', name: 'Apple Inc.', type: 'stock' }, { ticker: 'APLE', name: 'Apple Hospitality REIT, Inc.', type: 'stock' }],
  ALPHABET: [{ ticker: 'GOOGL', name: 'Alphabet Inc. Class A', type: 'stock' }, { ticker: 'GOOG', name: 'Alphabet Inc. Class C', type: 'stock' }],
  AMD: [{ ticker: 'AMD', name: 'Advanced Micro Devices, Inc.', type: 'stock' }],
}
function installSearch() {
  globalThis.fetch = vi.fn(async (url) => {
    const q = new URL(url, 'http://x').searchParams.get('q')?.toUpperCase()
    return new Response(JSON.stringify({ results: String(url).startsWith('/api/ticker-search') ? (SEARCH[q] || []) : [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}
const CTX = { surface: 'charts' }
async function run(host, ops) {
  const env = await prepareOps(ops)
  const plan = planOps(collectTargets(host, ['chart', 'watchlist']), ops, env, CTX)
  return { env, plan }
}

describe('grounded tickers and company names (N4)', () => {
  beforeEach(() => { _resetGrounding(); installSearch() })

  it('an EXACT company name resolves to its ONE ticker; look-alikes (a REIT, a leveraged ETF) never win', async () => {
    const g = await groundSymbols(['NVIDIA', 'APPLE', 'ALPHABET', 'BANANAS'])
    expect([...g.named].sort()).toEqual(['APPLE', 'NVIDIA'])
    expect([...g.ambiguous]).toEqual(['ALPHABET'])                     // two share classes: the member chooses
    expect([...g.unknown]).toEqual(['BANANAS'])
  })
  it('chart: "apple" charts AAPL (never the REIT) and the receipt names the company; the chart REALLY shows AAPL', async () => {
    const b = board()
    const ops = [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'apple' } }]
    const { plan } = await run(b.host, ops)
    expect(plan.ok).toBe(true)
    expect(plan.lines).toEqual(['Changed symbol to AAPL (Apple Inc.)'])
    const res = await commitPlan(b.host, plan)
    expect(res.ok).toBe(true)
    expect(b.host.charts.read('c1').symbol).toBe('AAPL')
  })
  it('chart: an ambiguous name is ASKED (both candidates named), an unknown one refused — nothing changes', async () => {
    const b = board()
    const amb = await run(b.host, [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'alphabet' } }])
    expect(amb.plan.refusals[0].reason).toMatch(/“alphabet” could be GOOGL \(Alphabet Inc\. Class A\) or GOOG \(Alphabet Inc\. Class C\) — which one\?/)
    const none = await run(b.host, [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'bananas' } }])
    expect(none.plan.refusals[0].reason).toMatch(/UCT has no symbol “BANANAS”/)
    expect(b.host.charts.read('c1').symbol).toBe('NVDA')                // the fixture's own symbol, unchanged
  })
  it('a real ticker is never re-interpreted as a name', async () => {
    const b = board()
    const { plan } = await run(b.host, [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AMD' } }])
    expect(plan.lines).toEqual(['Changed symbol to AMD'])
  })
  it('instant phrases: a lowercase ticker after a chart verb; known words and live names are never tickers', () => {
    expect(ops('pull up nvda')).toEqual([['chart.setSymbol', { symbol: 'NVDA' }]])
    expect(ops('chart amd')).toEqual([['chart.setSymbol', { symbol: 'AMD' }]])
    expect(ops('pull up nvidia')).toEqual([['chart.setSymbol', { symbol: 'NVIDIA' }]])   // grounded at prepare
    expect(ops('switch to weekly')).toEqual([['chart.setTimeframe', { timeframe: 'W' }]])
    expect(ops('pull up momentum')).not.toEqual([['chart.setSymbol', { symbol: 'MOMENTUM' }]])  // a list name
    expect(ops('load it')).toBeNull()                                     // a pronoun
    expect(ops('switch to candels')).not.toEqual([['chart.setSymbol', { symbol: 'CANDELS' }]])  // a typo of a known word
  })
  it('watchlist: "add apple to momentum" adds AAPL (named in the receipt); an ambiguous name adds NOTHING', async () => {
    const b = board()
    const f = fastParse('add apple to momentum', { host: b.host })
    const ops1 = f.ops.map(o => ({ ...o, target: o.target }))
    const { plan } = await run(b.host, ops1)
    expect(plan.ok).toBe(true)
    expect(plan.lines[0]).toMatch(/^Added AAPL to “Momentum” \(“apple” = AAPL, Apple Inc\.\)/i)
    const res = await commitPlan(b.host, plan)
    expect(res.ok).toBe(true)
    expect(b.state.server.lists.find(l => l.id === 'm1').items.map(i => i.sym)).toEqual(['NVDA', 'AAPL'])
    const amb = await run(b.host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['ALPHABET'] } }])
    expect(amb.plan.refusals[0].reason).toMatch(/could be GOOGL .* or GOOG .* Nothing was added/)
  })
})
