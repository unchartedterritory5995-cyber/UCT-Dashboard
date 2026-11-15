// ⛔ MULTI-RESYMBOL RAIL (hotfix 2026-11-13, AUDIT held-out probe 33 e1 / e2): a plan that gives TWO OR MORE existing charts new
// tickers in one turn is refused unless the words say so outright — STRUCTURAL (chartRail MULTI), whatever the words' casing or
// verb, and whatever reader or model planned it. Generated: casing (upper / lower / mixed) × verb (add / put / show / bring up /
// load / none) × boards of 2, 3 and 4 charts; the plan re-symbols 2 charts, or every chart. Controls: a single-chart change still
// writes; an explicit replace of several charts still writes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal } from './chartRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

const settings = () => ({ settings: mergeChartSettings(null) })
const SYMS = ['SPY', 'NVDA', 'AMD', 'QQQ']
// n charts in one row (left … right), each unlinked on its own ticker
const board = (n) => [Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * Math.floor(24 / n), y: 0, w: Math.floor(24 / n), h: 20, color: 'N', opts: settings() })),
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i + 1}`, SYMS[i]]))]
const NEW = ['AAPL', 'MSFT', 'TSLA', 'META']
const CASES = { upper: (s) => s.toUpperCase(), lower: (s) => s.toLowerCase(), mixed: (s) => s[0] + s.slice(1).toLowerCase() }
const VERBS = { add: 'add', put: 'put', show: 'show', 'bring up': 'bring up', load: 'load', none: '' }
const list = (xs) => (xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const said = (verb, tickers) => `${verb ? `${verb} ` : ''}${list(tickers)}`.trim()
const resymbol = (n, k) => Array.from({ length: k }, (_, i) => ({ action: 'chart.setSymbol', target: `c${i + 1}`, args: { symbol: NEW[i] } }))
const gridReuse = (k) => [{ action: 'chartGrid.set', target: 'board', args: { symbols: NEW.slice(0, k), timeframe: null, layout: null, new_charts: null, watchlist: null, replace: null } }]
function plan(b, ops) {
  const kinds = [...new Set(ops.map(o => (o.action === 'chartGrid.set' ? 'board' : 'chart')))]
  return planOps(collectTargets(b.host, kinds), ops, {}, { surface: 'charts' })
}

describe('MULTI · the rail refuses a plan re-symbolling ≥ 2 existing charts — casing × verb × board', () => {
  for (const n of [2, 3, 4]) for (const [cname, cs] of Object.entries(CASES)) for (const [vname, verb] of Object.entries(VERBS)) {
    const tickers = NEW.slice(0, 2).map(cs)
    const words = said(verb, tickers)
    it(`${n} charts · ${cname} · ${vname} · "${words}"`, () => {
      const b = makeBoard(...board(n))
      for (const ops of [resymbol(n, 2), resymbol(n, n), gridReuse(Math.min(n, 4))]) {
        const p = plan(b, ops)
        expect(p.ok, JSON.stringify(ops)).toBe(true)
        expect(chartRailRefusal(p, { words, host: b.host, mode: 'apply' }), `${words} · ${ops[0].action} ×${ops.length}`).toBeTruthy()
      }
    })
  }
  for (const n of [2, 3, 4]) for (const words of ['put these up there', 'pop those two in', 'can I see apple and microsoft', 'aapl msft']) {
    it(`${n} charts · colloquial "${words}"`, () => {
      const b = makeBoard(...board(n))
      expect(chartRailRefusal(plan(b, resymbol(n, 2)), { words, host: b.host, mode: 'apply' })).toBeTruthy()
    })
  }
})

describe('lowercase tickers count (AUDIT probe 33 e1): an ADD of one lowercase ticker never re-symbols the one existing chart it hit', () => {
  for (const n of [2, 3, 4]) for (const words of ['add aapl', 'please add aapl', 'add aapl to my layout', 'I want aapl added']) {
    it(`${n} charts · "${words}" + a plan re-symbolling ONE chart → refused (additive, the lowercase ticker read)`, () => {
      const b = makeBoard(...board(n))
      expect(chartRailRefusal(plan(b, resymbol(n, 1)), { words, host: b.host, mode: 'apply' })).toMatch(/you asked for more charts/)
    })
  }
})

describe('MULTI · controls — a single-chart change and an explicit multi-chart replace are allowed by the rail', () => {
  for (const n of [1, 2, 3, 4]) for (const words of ['pull up AAPL', 'pull up aapl', 'show AAPL', 'load aapl', 'switch to AAPL']) {
    it(`single chart re-symbolled · ${n} chart board · "${words}"`, () => {
      const b = makeBoard(...board(n))
      expect(chartRailRefusal(plan(b, resymbol(n, 1)), { words, host: b.host, mode: 'apply' })).toBe(null)
    })
  }
  for (const words of ['replace both charts with AAPL and MSFT', 'swap out SPY and NVDA for AAPL and MSFT', 'change the left to AAPL and the right to MSFT',
    'AAPL on the left and MSFT on the right', 'make a 2x2 of AAPL MSFT TSLA META', 'four charts for aapl msft tsla meta']) {
    it(`explicit · "${words}"`, () => {
      const b = makeBoard(...board(2))
      expect(chartRailRefusal(plan(b, resymbol(2, 2)), { words, host: b.host, mode: 'apply' })).toBe(null)
    })
  }
  it('a linked group: one symbol change that its link group follows is ONE change (not refused)', () => {
    const b = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }, { id: 'c2', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'SPY' })
    expect(chartRailRefusal(plan(b, resymbol(2, 1)), { words: 'pull up aapl', host: b.host, mode: 'apply' })).toBe(null)
  })
})

// through the REAL panel: the scripted model plans the two-chart re-symbol (AUDIT e1 / e2), and the explicit replace controls write
let envelopes, calls
const env = (disposition, ops) => ({ disposition, reply: '', question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url)])
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift() || env('answer', []), usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount(n) {
  const b = makeBoard(...board(n))
  const h = { ...b.host, charts: { ...b.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const syms = () => b.state.widgets.filter(w => w.type === 'chart').map(w => h.charts.read(w.id).symbol)
  return { say, syms }
}
describe('MULTI · through the real panel', () => {
  for (const words of ['add aapl and msft', 'put these up there', 'Show Aapl and Msft', 'bring up aapl and msft']) {
    it(`AUDIT probe 33 shape · "${words}" + a model plan re-symbolling both charts → refused, SPY and NVDA kept`, async () => {
      const { say, syms } = mount(2)
      envelopes.push(env('apply', resymbol(2, 2)))
      await say(words)
      expect(syms().slice(0, 2)).toEqual(['SPY', 'NVDA'])
    }, 30000)
  }
  for (const words of ['replace both charts with AAPL and MSFT', 'swap out SPY and NVDA for AAPL and MSFT', 'change the left to AAPL and the right to MSFT']) {
    it(`explicit replace control · "${words}" → AAPL, MSFT`, async () => {
      const { say, syms } = mount(2)
      envelopes.push(env('apply', resymbol(2, 2)))
      await say(words)
      expect(syms()).toEqual(['AAPL', 'MSFT'])
    }, 30000)
  }
  it('single-chart control · one chart, "pull up aapl" → AAPL', async () => {
    const { say, syms } = mount(1)
    envelopes.push(env('apply', resymbol(1, 1)))
    await say('pull up aapl')
    expect(syms()).toEqual(['AAPL'])
  }, 30000)
})
