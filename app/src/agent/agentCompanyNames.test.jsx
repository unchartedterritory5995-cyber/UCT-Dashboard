// A COMPANY NAME where a ticker goes ("pull up nvidia on this one"): resolved to its one ticker before any symbol is refused, on
// every way of naming the chart ("this one", "this chart", a named chart). An unknown name is refused or goes to the model; a
// symbol change is receipted only when the chart shows a KNOWN ticker, never the literal word.
// pl-auto symbol-01 (BROWSER-MOCK-MODEL): "pull up nvidia on this one" answered "UCT has no symbol NVIDIA" with no model call;
// AUDIT: "pull up nvidia on this chart" set the literal NVIDIA and receipted it. Fixture names, no market data.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings, MODEL_SENTINEL } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

// the ticker search as the server answers it: a ticker by its ticker, a company by its name
const COMPANIES = [{ ticker: 'NVDA', name: 'NVIDIA Corporation' }, { ticker: 'AMD', name: 'Advanced Micro Devices, Inc.' }, { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust' }, { ticker: 'QQQ', name: 'Invesco QQQ Trust' }, { ticker: 'TSLA', name: 'Tesla, Inc.' }, { ticker: 'PLTR', name: 'Palantir Technologies Inc.' }]
let p
beforeEach(() => {
  p = setupPanel()
  const base = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init) => {
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) {
      const w = decodeURIComponent(q[1]).toLowerCase()
      const rows = COMPANIES.filter(c => c.ticker.toLowerCase() === w || c.name.toLowerCase().includes(w))
      return new Response(JSON.stringify({ results: rows }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return base(url, init)
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const BOARD = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'AMD', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const mount = (clicked) => { const m = p.mount(BOARD, SYMS, { decorate: label }); if (clicked) p.select(clicked); return m }

describe('a company name resolves to its ticker on every way of naming the chart', () => {
  it.each([
    ['pull up nvidia on this one', 'c2'],
    ['pull up nvidia on this chart', 'c2'],
    ['switch this chart to nvidia', 'c3'],
  ])('%s (clicked %s): the chart shows NVDA, the receipt names NVDA, never the word', async (t, clicked) => {
    const { say, board: b } = mount(clicked)
    const out = await say(t)
    expect(symOf(b, clicked), out).toBe('NVDA')
    expect(out).toMatch(/NVDA/)
    expect(out).not.toMatch(/no symbol|Changed symbol to NVIDIA\b(?! \()/)
  }, 30000)
  // pl-auto symbol-01: a ticker search that does NOT know the name (the browser rig's knows tickers only): the instant path never
  // refuses it unread, the model reads it, and its plan on the clicked chart lands
  it.each([['pull up palantir on this one'], ['pull up palantir on this chart']])('%s, a ticker search that knows no names: the model reads it; never "no symbol"', async (t) => {
    globalThis.fetch = ((base) => vi.fn(async (url, init) => (/ticker-search\?q=palantir/i.test(String(url))
      ? new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) : base(url, init))))(globalThis.fetch)
    const { say, board: b } = mount('c2')
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: body.context.charts.find(c => c.label === 'Chart (c2)').ref, args: { symbol: 'PLTR' } }]))
    const out = await say(t)
    expect(p.turns(), out).toBe(1)
    expect(out).not.toMatch(/no symbol/)
    expect(symOf(b, 'c2')).toBe('PLTR')
  }, 30000)
  it('a chart named by its ticker: "put nvidia on the TSLA chart" → that chart shows NVDA', async () => {
    const { say, board: b } = mount(null)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: body.context.charts.find(c => c.symbol === 'TSLA').ref, args: { symbol: 'nvidia' } }]))
    const out = await say('put nvidia on the TSLA chart')
    expect(symOf(b, 'c3'), out).toBe('NVDA')
  }, 30000)
  it.each([['pull up zzyzxcorp on this one'], ['pull up zzyzxcorp on this chart']])('NEGATIVE %s: an unknown name changes nothing and is never receipted as a symbol', async (t) => {
    const { say, board: b } = mount('c2')
    const out = await say(t)
    expect(symOf(b, 'c2')).toBe('AMD')
    expect(out).not.toMatch(/Changed symbol/)
    expect(out === '' ? MODEL_SENTINEL : out).toMatch(/no symbol|ticker|«the model was asked»/)
  }, 30000)
})

// AUDIT N1: the instant path's lookup is bounded (NAME_SEARCH_MS): a ticker search that never answers still reaches the model,
// and the turn is not held
describe('a ticker search that never answers', () => {
  it.each([['pull up oracle on this one'], ['pull up oracle on this chart']])('%s: the model is asked within the bound; nothing is refused unread', async (t) => {
    globalThis.fetch = ((base) => vi.fn((url, init) => (/ticker-search/i.test(String(url)) ? new Promise(() => {}) : base(url, init))))(globalThis.fetch)
    const { say, board: b } = mount('c2')
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: body.context.charts.find(c => c.label === 'Chart (c2)').ref, args: { symbol: 'ORCL' }, trusted: true }]))
    const t0 = Date.now()
    const out = await say(t)
    expect(p.turns(), out).toBe(1)
    expect(out).not.toMatch(/no symbol/)
    expect(Date.now() - t0).toBeLessThan(9000)
    void b
  }, 30000)
})
