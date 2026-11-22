// MULTI-STEP CONTINUITY PROBES (investigation, 2026-11-14) — through the REAL panel (panelHarness: AgentPanel + useAgent +
// registry, routing, planner, policy, runtime, receipts and Undo) on the REAL board writer. Stand-in: the Agent model, scripted.
// No paid model call. Each probe states a behaviour the owner wants of a multi-step task; the result is recorded in the PR.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, FOUR, MODEL_SENTINEL } from './testing/panelHarness'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chartOf = (b, sym) => b.context.charts.find(c => c.label === `Chart (${sym})`).ref
const ws = (b) => (Object.values(b.context || {}).flat().find(e => /workspace/i.test(String(e?.label || e?.ref)))?.ref) || 'workspace'
const clarify = (q) => ({ disposition: 'clarify', reply: q, question: { text: q, choices: [] }, ops: [], unsupported_category: null })
const scaleOf = (h, id) => h.charts.read(id)?.scale ?? null
const logged = (board) => board.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()
const tfs = (board, h) => board.state.widgets.filter(w => w.type === 'chart').map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])

describe('probe a · intent kept across a clarification for a multi-step task', () => {
  it('a non-layout multi-step task: the short answer goes to the model with the question (never routed alone)', async () => {
    const m = p.mount(...FOUR())
    p.st.envelopes.push(clarify('Which timeframe should the four charts use?'))
    await m.say('Put RSI on all four charts and switch them to a higher timeframe')
    p.st.envelopes.push(b => p.env('apply', ['SPY', 'QQQ', 'NVDA', 'TSLA'].map(s => ({ action: 'chart.setTimeframe', target: chartOf(b, s), args: { timeframe: 'W' } }))))
    await m.say('weekly')
    expect(p.turns()).toBe(2)
    expect(p.lastTurnBody().context?.conversation_memory?.question_set_aside).not.toBe(true)
    expect(tfs(m.board, m.h).map(x => x[1])).toEqual(['W', 'W', 'W', 'W'])
  }, 30000)
})

describe('probe b · constraints and exclusions carried into the reply turn', () => {
  it('"…except the TSLA one" → asked → "log": a plan that forgets the exclusion never changes TSLA', async () => {
    const m = p.mount(...FOUR())
    p.st.envelopes.push(clarify('Which scale do you want — log or percent?'))
    await m.say('Change the price scale on all my charts except the TSLA one')
    expect(logged(m.board)).toEqual([])
    p.st.envelopes.push(b => p.env('apply', ['SPY', 'QQQ', 'NVDA', 'TSLA'].map(s => ({ action: 'chart.setScale', target: chartOf(b, s), args: { scale: 'log' } }))))
    await m.say('log')
    expect(p.turns()).toBe(2)
    if (p.proposals().length) await m.click('Apply')
    expect(logged(m.board), p.transcript()).not.toContain('c3')
  }, 30000)
})

describe('probe c · references to the charts a step created', () => {
  it('"make the new charts weekly" after the model opened two charts', async () => {
    const m = p.mount(...FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x)))
    await m.say('open charts for AAPL and MSFT')
    expect(p.turns()).toBe(0)
    expect(tfs(m.board, m.h).map(x => x[0])).toEqual(['SPY', 'QQQ', 'AAPL', 'MSFT'])
    const out = await m.say(process.env.PHRASE || 'make the new charts weekly')
    if (process.env.DUMP) console.log('DUMP>>', p.turns(), JSON.stringify(p.lastTurnBody()?.context?.charts), JSON.stringify(p.lastTurnBody()?.context?.conversation_memory || p.lastTurnBody()?.context?.session || Object.keys(p.lastTurnBody()?.context || {})), out, JSON.stringify(m.board.state.widgets.map(w => [w.id, m.h.charts.read(w.id)?.symbol, m.h.charts.read(w.id)?.tf])))
    expect(tfs(m.board, m.h), out).toEqual([['SPY', 'D'], ['QQQ', 'D'], ['AAPL', 'W'], ['MSFT', 'W']])
    expect(out).not.toContain(MODEL_SENTINEL)
  }, 30000)
  it('"put them on a log scale" after the model opened two charts', async () => {
    const m = p.mount(...FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x)))
    await m.say('open charts for AAPL and MSFT')
    expect(p.turns()).toBe(0)
    const out = await m.say('put them on a log scale')
    const ids = m.board.state.widgets.filter(w => w.type === 'chart').map(w => [m.h.charts.read(w.id).symbol, !!w.opts?.settings?.logScale])
    expect(ids, out).toEqual([['SPY', false], ['QQQ', false], ['AAPL', true], ['MSFT', true]])
  }, 30000)
})

void scaleOf

// ── d / e / f / g: screen → the top N as charts (compose.js refs), on a board that already has charts ──
const META = { fields: [{ key: 'price', label: 'Price', type: 'range', unit: '$' }, { key: 'chg_pct_3m', label: 'Change 3M', type: 'range', unit: '%' }] }
const ROWS = (n) => ['AAPL', 'MSFT', 'NVDA', 'AMD', 'AVGO', 'MU'].slice(0, n).map((ticker, i) => ({ ticker, price: 50 + i, chg_pct_3m: 60 - 5 * i }))
function withScreener(n) {
  const inner = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json(META)
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') { p.st.calls.push(['POST', url, null]); return json({ total: n, rows: ROWS(n), snapshot_date: '2026-11-13' }) }
    if (/\/state\/lastScreen$/.test(String(url))) return json({ key: 'lastScreen', value: null })
    return inner(url, init)
  })
}
const SPEC = { filters: [{ field: 'price', op: 'gte', value: 10, max: null, values: null }], sort_field: 'chg_pct_3m', sort_dir: 'desc', mode: 'new', show: null, as: 'screen1', within: null }
const screenToCharts = (top, exact = null) => (b) => p.env('propose', [
  { action: 'screener.run', target: (b.context.screener || [])[0]?.ref || 's1', args: SPEC },
  { action: 'widget.addCharts', target: ws(b), args: { symbols: { from: 'screen1', top }, timeframe: null, chart_type: null, exact } },
])
const syms = (board, h) => board.state.widgets.filter(w => w.type === 'chart').map(w => h.charts.read(w.id).symbol)

describe('probe d/e/g · screen → top four as charts → change the new charts → one Undo', () => {
  it('dependent steps in order; the board\'s own charts kept; "undo" restores exactly', async () => {
    const m = p.mount(...FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x)))
    withScreener(6); _resetScreenerCache(); await loadMeta()
    const before = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(screenToCharts(4))
    await m.say('Find stocks over $10, strongest three-month change first, and open charts for the top four')
    expect(p.proposals().length, p.transcript()).toBe(1)
    await m.say('do it')
    expect(syms(m.board, m.h), p.transcript()).toEqual(['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMD'])
    const out = await m.say(process.env.PHRASE2 || 'make the new charts weekly')
    expect(tfs(m.board, m.h).map(x => x[1]), out).toEqual(['D', 'D', 'W', 'W', 'W', 'W'])
    await m.say('undo')
    await m.say('undo')
    expect(JSON.stringify(m.board.state.widgets), p.transcript()).toBe(before)
  }, 40000)
})

describe('probe f · a dependent step whose input comes back short', () => {
  it('exact four, the screen returns two: nothing is created, said exactly', async () => {
    const m = p.mount(...FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x)))
    withScreener(2); _resetScreenerCache(); await loadMeta()
    const before = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(screenToCharts(4, true))
    await m.say('Find stocks over $10 and open exactly four charts of the strongest')
    await m.say('do it')
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
    expect(p.transcript()).toMatch(/only 2 stocks came back and you asked for exactly 4/)
    expect(p.transcript()).not.toMatch(/Created/)
  }, 40000)
})
