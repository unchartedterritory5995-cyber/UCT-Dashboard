// UCT AGENT EVALUATION SET (Phase 1 Gate F) — a repeatable, local, non-paid measurement.
//
// Realistic requests run through the REAL panel, fast path, router, planner, composer, runtime,
// receipts and Undo against an in-memory UCT (fixture board, watchlist server, Screener engine,
// session data). The MODEL is scripted, and MANIFEST-AWARE: for each request it returns the plan a
// correct model would return FROM THE ACTIONS IT WAS SENT — and where that manifest cannot express
// the request (an older build), the question a correct model must then ask. The same file runs
// unchanged on master (before) and on this branch (after), so the numbers compare the SYSTEM, not
// a model's luck. It cannot measure real-model wording or real-model latency (see the report).
//
// Per task it records: completed (checked against independently computed state), questions asked
// (necessary vs unnecessary), model calls, UCT tool calls, writes before approval, local ms.
// `AGENT_EVAL_OUT=<file>` also writes the rows as JSON.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import { registerBuiltins } from './builtins'
import * as screenerMod from './capabilities/screener'
import * as watchlistMod from './capabilities/watchlist'
import { makeBoard } from './__fixtures__/board'
import * as traceMod from './trace'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// ── the fixture market (same shape as agentPhase1.test.jsx) ──
const INDUSTRIES = ['Software - Application', 'Software - Infrastructure', 'Semiconductors', 'Banks - Regional', 'Biotechnology']
const UNIVERSE = Array.from({ length: 1500 }, (_, i) => ({
  ticker: `S${String(i).padStart(4, '0')}`, industry: i % 7 === 6 ? null : INDUSTRIES[i % INDUSTRIES.length],
  price: 4 + (i % 40), adr_pct: 2 + (i % 9), close: 3 + ((i * 7) % 45) + 0.5, volume: 50_000 + ((i * 13) % 900) * 1_000,
}))
const isSoftware = (r) => r.industry === 'Software - Application' || r.industry === 'Software - Infrastructure'
const SOFTWARE = UNIVERSE.filter(r => isSoftware(r) && r.close > 10 && r.close * r.volume > 10_000_000).map(r => r.ticker)
const ADR = UNIVERSE.filter(r => r.adr_pct > 5 && r.price > 10).map(r => r.ticker)

let calls = []
let turnQueue = []
let savedScreens = []
function installFetch() {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') {
      return json({ fields: [
        { key: 'price', label: 'Price', type: 'range', unit: '$', category: 'descriptive' },
        { key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%', category: 'technical' },
        { key: 'dollar_vol_30d', label: 'Dollar Volume (30d)', type: 'range', unit: '$', category: 'descriptive' },
        { key: 'industry', label: 'Industry', type: 'enum', category: 'descriptive' },
      ] })
    }
    if (url === '/api/screener/fields?options=1') return json({ options: { industry: { values: [...INDUSTRIES].sort(), with_value: UNIVERSE.filter(r => r.industry).length, total: UNIVERSE.length } } })
    if (url === '/api/screener/saved-screens' && (init.method || 'GET') === 'POST') {
      const row = { id: 900 + savedScreens.length, name: body.name, spec: body.spec }
      savedScreens.push(row)
      return json(row)
    }
    if (url === '/api/screener/saved-screens') return json({ saved: savedScreens, starters: [] })
    if (url === '/api/screener/scan') {
      const ok = (r, f) => (f.op === 'in' ? f.values.includes(r[f.key]) : f.op === 'gt' ? r[f.key] > f.min : f.op === 'lt' ? r[f.key] < f.max : true)
      const rows = UNIVERSE.filter(r => body.filters.every(f => ok(r, f)))
      const start = (body.page - 1) * body.page_size
      return json({ total: rows.length, rows: rows.slice(start, start + body.page_size).map(r => ({ ticker: r.ticker, price: r.price, adr_pct: r.adr_pct })), snapshot_date: '2026-10-10' })
    }
    if (url === '/api/agent/session-stats') {
      const rows = {}
      for (const t of body.symbols) { const r = UNIVERSE.find(x => x.ticker === t); if (r) rows[t] = { close: r.close, volume: r.volume, dollar_volume: r.close * r.volume } }
      return json({ session: '2026-10-09', rows, missing: [] })
    }
    if (url === '/api/agent/turn') {
      const f = turnQueue.shift()
      return json({ conversationId: 'ac_eval', envelope: f ? f(body) : env('answer', [], 'ok'), usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_eval' })
    if (String(url).startsWith('/api/ticker-search')) {
      const q = new URL(url, 'http://x').searchParams.get('q')
      return json({ results: ['NVDA', 'AMD', 'AAPL', 'TSLA'].includes(q) ? [{ ticker: q }] : [] })
    }
    return json({ conversations: [] })
  })
}

// ── the manifest-aware scripted model ──
const env = (disposition, ops, reply = '', question = null) => ({ disposition, reply, question, ops, unsupported_category: null })
const ask = (text, choices = []) => env('clarify', [], '', { text, choices })
const has = (body, name) => (body.capabilities || []).some(c => c.name === name)
const ref = (body, key, i = 0) => body.context[key]?.[i]?.ref
const listRef = (body, name) => (body.context.watchlists || []).find(l => l.name === name)?.ref
const filterProps = (body) => (body.capabilities || []).find(c => c.name === 'screener.run')?.args?.properties?.filters?.items?.properties || {}
const canListFilter = (body) => !!filterProps(body).values
const canSessionDV = (body) => /dollar_volume_1d/.test(body.context.screener?.[0]?.fields || '')
const F = (body, field, op, value, extra = {}) => (canListFilter(body) ? { field, op, value, max: null, values: null, ...extra } : { field, op, value, max: null })

// The software watchlist request. With list filters + session measures + watchlist.open: the whole plan.
// Without them (master): a correct model can't express "software" → it must ask (as production did).
const softwarePlan = (open = true) => (body) => {
  if (!canListFilter(body) || !canSessionDV(body)) return ask('Which software stocks do you want in the list? I can screen by price and volume but not by industry.')
  return env('propose', [
    { action: 'screener.run', target: ref(body, 'screener'), args: { filters: [
      F(body, 'industry', 'in', null, { values: ['software'] }), F(body, 'price', 'gt', 10), F(body, 'dollar_volume_1d', 'gt', 10_000_000),
    ], sort_field: null, sort_dir: null, mode: 'new', show: null, as: 'screen1' } },
    { action: 'watchlist.create', target: ref(body, 'watchlistLibrary'), args: { name: 'Software Over $10', as: 'list1' } },
    { action: 'watchlist.add', target: 'list1', args: { symbols: { from: 'screen1', top: null } } },
    ...(open && has(body, 'watchlist.open') ? [{ action: 'watchlist.open', target: ref(body, 'board'), args: { list: 'list1' } }] : []),
  ])
}
const adrScreen = (body) => env('apply', [{ action: 'screener.run', target: ref(body, 'screener'), args: { filters: [F(body, 'adr_pct', 'gt', 5), F(body, 'price', 'gt', 10)], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null } }])
const fromLast = (name, top) => (body) => env('propose', [
  { action: 'watchlist.create', target: ref(body, 'watchlistLibrary'), args: { name, as: 'list1' } },
  { action: 'watchlist.add', target: 'list1', args: { symbols: { from: 'lastScreen', top } } },
])
const openList = (name) => (body) => (has(body, 'watchlist.open')
  ? env('apply', [{ action: 'watchlist.open', target: ref(body, 'board'), args: { list: listRef(body, name) } }])
  : env('apply', [{ action: 'widget.showList', target: ref(body, 'board'), args: { widget: 'wl', list: listRef(body, name) } }]))
const tf = (value, i = 0) => (body) => env('apply', [{ action: 'chart.setTimeframe', target: ref(body, 'charts', i), args: { timeframe: value } }])
const type = (value) => (body) => env('apply', [{ action: 'chart.setType', target: ref(body, 'charts'), args: { type: value } }])
const addSyms = (list, symbols) => (body) => env('apply', [{ action: 'watchlist.add', target: listRef(body, list), args: { symbols } }])
const deleteList = (list) => (body) => env('propose', [{ action: 'watchlist.delete', target: listRef(body, list), args: {} }])

const chartRef = (b) => ref(b, 'charts')
const ixeRef = (b) => ref(b, 'indicatorEdits')
const workflowA = (b) => env('apply', [
  { action: 'chart.setSymbol', target: chartRef(b), args: { symbol: 'NVDA' } },
  { action: 'chart.setTimeframe', target: chartRef(b), args: { timeframe: 'W' } },
  ...(has(b, 'indicator.add') ? [{ action: 'indicator.add', target: ixeRef(b), args: { defId: 'rsi' } }] : []),
], 'I can add RSI; a 20 EMA with its own period is set from the chart\'s Indicators menu.')
const workflowD = (b) => env('propose', [
  { action: 'screener.run', target: ref(b, 'screener'), args: { filters: [F(b, 'adr_pct', 'gt', 5), F(b, 'price', 'gt', 10)], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, ...(filterProps(b).values ? {} : {}), ...((b.capabilities || []).find(c => c.name === 'screener.run')?.args?.properties?.within ? { within: null } : {}) } },
  { action: 'screener.saveAs', target: ref(b, 'savedScreenLibrary'), args: { name: 'ADR Movers' } },
])
const removeRsi = (b) => env('propose', [{ action: 'indicator.remove', target: ixeRef(b), args: { instance: 'rsi' } }])
const indicatorIds = (st) => {
  const w = st.widgets.find(x => x.id === 'c1')
  const cs = w?.opts?.settings
  const list = (cs && typeof cs === 'object' ? cs.indicatorInstances : null) || []
  return list.filter(i => !i.deleted).map(i => i.defId)
}
const symOf = (st) => st.groupSyms[st.widgets.find(w => w.id === 'c1')?.color === 'N' ? 'N:c1' : (st.widgets.find(w => w.id === 'c1')?.color || 'A')]

// ── the scenarios ──
const ONE_CHART = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, opts: { settings: JSON.stringify({ chartType: 'bars' }) } }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1', watchName: 'Momentum', watchTab: 'mine' } }]
const TWO_CHARTS = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 9, h: 20 }, { id: 'c2', type: 'chart', x: 9, y: 0, w: 9, h: 20 }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1' } }]
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }]
const listNamed = (st, n) => st.server.lists.find(l => l.name === n)
const syms = (st, n) => (listNamed(st, n)?.items || []).map(i => i.sym)
const shown = (st) => st.widgets.find(w => w.type === 'watchlist')?.opts?.watchKey
const tfOf = (st, id = 'c1') => st.widgets.find(w => w.id === id)?.opts?.tf || 'D'

const SCENARIOS = [
  { id: 'software-watchlist-open', cat: 'multi-step', say: [['Make me a watchlist of all software stocks over $10 that trade over $10 million in daily dollar volume, and open it in my workspace.', softwarePlan(true)], ['do it']],
    done: (st) => JSON.stringify(syms(st, 'Software Over $10')) === JSON.stringify(SOFTWARE) && shown(st) === `user:${listNamed(st, 'Software Over $10')?.id}`, approval: true },
  { id: 'software-watchlist', cat: 'multi-step', say: [['Find software stocks over $10 with over $10M daily dollar volume and make a watchlist', softwarePlan(false)], ['do it']],
    done: (st) => JSON.stringify(syms(st, 'Software Over $10')) === JSON.stringify(SOFTWARE), approval: true },
  { id: 'open-just-made', cat: 'follow-up', say: [['Make me a watchlist of all software stocks over $10 that trade over $10 million in daily dollar volume', softwarePlan(false)], ['do it'], ['open the watchlist you just made', openList('Software Over $10')]],
    done: (st) => !!listNamed(st, 'Software Over $10') && shown(st) === `user:${listNamed(st, 'Software Over $10').id}` },
  { id: 'screen-then-all', cat: 'follow-up', say: [['show me stocks with ADR above 5% and price above $10', adrScreen], ['put all of them in a new watchlist called ADR All', fromLast('ADR All', null)], ['do it']],
    done: (st) => JSON.stringify(syms(st, 'ADR All')) === JSON.stringify(ADR), approval: true },
  { id: 'screen-then-top10', cat: 'follow-up', say: [['show me stocks with ADR above 5% and price above $10', adrScreen], ['put the top 10 in a new watchlist called ADR Leaders', fromLast('ADR Leaders', 10)], ['do it']],
    done: (st) => JSON.stringify(syms(st, 'ADR Leaders')) === JSON.stringify(ADR.slice(0, 10)), approval: true },
  { id: 'tf-my-chart-15', cat: 'simple', say: [['Change my chart to 15 minutes', tf('15')]], done: (st) => tfOf(st) === '15' },
  { id: 'tf-switch-the-15', cat: 'simple', say: [['switch to the 15 minute', tf('15')]], done: (st) => tfOf(st) === '15' },
  { id: 'tf-the-timeframe-weekly', cat: 'simple', say: [['change the timeframe to weekly', tf('W')]], done: (st) => tfOf(st) === 'W' },
  { id: 'tf-weekly', cat: 'simple', say: [['weekly', tf('W')]], done: (st) => tfOf(st) === 'W' },
  { id: 'type-my-chart-candles', cat: 'simple', say: [['change my chart to candles', type('candles')]], done: (st) => /candles/.test(JSON.stringify(st.widgets.find(w => w.id === 'c1').opts)) },
  { id: 'symbol-switch', cat: 'simple', say: [['switch to NVDA', (b) => env('apply', [{ action: 'chart.setSymbol', target: ref(b, 'charts'), args: { symbol: 'NVDA' } }])]], done: (st) => Object.values(st.groupSyms).includes('NVDA') },
  { id: 'add-to-list', cat: 'simple', say: [['add NVDA and AMD to Swing', addSyms('Swing', ['NVDA', 'AMD'])]], done: (st) => JSON.stringify(syms(st, 'Swing')) === JSON.stringify(['TSLA', 'NVDA', 'AMD']) },
  { id: 'open-named-list', cat: 'simple', say: [['open my Swing watchlist', openList('Swing')]], done: (st) => shown(st) === 'user:s1' },
  { id: 'screen-answer', cat: 'simple', say: [['show me stocks with ADR above 5% and price above $10', adrScreen]], done: () => /stocks match/.test(document.body.textContent) },
  { id: 'two-charts-which', cat: 'necessary-question', widgets: TWO_CHARTS, say: [['make the chart weekly', () => ask('Which chart?', ['Chart c1', 'Chart c2'])]], done: (st) => tfOf(st, 'c1') === 'D' && tfOf(st, 'c2') === 'D', questionOk: true },
  { id: 'delete-which-list', cat: 'necessary-question', say: [['delete my watchlist', () => ask('Which watchlist?', ['Momentum', 'Swing'])]], done: (st) => st.server.lists.length === 2, questionOk: true },
  { id: 'delete-needs-approval', cat: 'approval', say: [['delete the Swing watchlist', deleteList('Swing')]], done: (st) => !!listNamed(st, 'Swing') && !!document.querySelector('[data-testid="agent-proposal"]'), approval: true },
  { id: 'delete-approved', cat: 'approval', say: [['delete the Swing watchlist', deleteList('Swing')], ['do it']], done: (st) => !listNamed(st, 'Swing'), approval: true },
  { id: 'duplicate-do-it', cat: 'safety', say: [['Find software stocks over $10 with over $10M daily dollar volume and make a watchlist', softwarePlan(false)], ['do it'], ['do it']],
    done: (st) => st.server.lists.filter(l => l.name === 'Software Over $10').length === 1, approval: true },
  // ── Phase 2 workflows (Milestone 4) ──
  { id: 'wf-A-chart-config', cat: 'multi-step', say: [['Open NVDA, change it to the weekly chart, and add RSI', workflowA]],
    done: (st) => symOf(st) === 'NVDA' && tfOf(st) === 'W' && indicatorIds(st).includes('rsi') },
  { id: 'wf-C-existing-resources', cat: 'multi-step', say: [['Open my Swing watchlist and show AAPL on the main chart', (b) => env('apply', [
    { action: 'chart.setSymbol', target: chartRef(b), args: { symbol: 'AAPL' } },
    has(b, 'watchlist.open') ? { action: 'watchlist.open', target: ref(b, 'board'), args: { list: listRef(b, 'Swing') } } : { action: 'widget.showList', target: ref(b, 'board'), args: { widget: 'wl', list: listRef(b, 'Swing') } }])]],
    done: (st) => shown(st) === 'user:s1' && symOf(st) === 'AAPL' },
  { id: 'wf-D-screen-save-show', cat: 'multi-step', say: [['Find stocks with ADR above 5% and price above $10, save them as ADR Movers, and show me the results', workflowD], ['do it']],
    done: () => savedScreens.some(x => x.name === 'ADR Movers') && /stocks match/.test(document.body.textContent), approval: true },
  { id: 'wf-E-follow-up', cat: 'follow-up', say: [['Open NVDA, change it to the weekly chart, and add RSI', workflowA], ['Now change that chart to 15 minutes and remove RSI', (b) => env('propose', [
    { action: 'chart.setTimeframe', target: chartRef(b), args: { timeframe: '15' } }, { action: 'indicator.remove', target: ixeRef(b), args: { instance: 'rsi' } }])], ['do it']],
    done: (st) => tfOf(st) === '15' && !indicatorIds(st).includes('rsi') },
  { id: 'undo-open', cat: 'safety', say: [['open my Swing watchlist', openList('Swing')], ['undo']], done: (st) => shown(st) === 'user:m1' },
]

const rows = []
beforeEach(() => {
  screenerMod._resetScreenerCache()
  watchlistMod._resetLastCreated?.()
  try { localStorage.clear() } catch { /* */ }
  calls = []; turnQueue = []; savedScreens = []
  installFetch()
})
afterAll(() => {
  const out = globalThis.process?.env?.AGENT_EVAL_OUT
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2))
  const pct = (xs) => (xs.length ? Math.round((100 * xs.filter(Boolean).length) / xs.length) : 0)
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0 }
  const lines = rows.map(r => `EVAL|${r.id}|${r.cat}|done=${r.done ? 'Y' : 'n'}|model=${r.modelCalls}|tools=${r.toolCalls}|q=${r.questions}${r.unnecessaryQuestions ? '(U)' : ''}|preWrites=${r.writesBeforeApproval}|ms=${r.ms}|exec=${r.execMs ?? '-'}|prompt=${r.promptBytes ?? '-'}|reads=${r.preModelReads ?? '-'}`)
  const all = rows.filter(r => r.cat !== 'necessary-question')
  lines.push(`EVALSUM|tasks=${rows.length}|completed=${pct(rows.map(r => r.done))}%|unnecessaryQuestionRate=${pct(all.map(r => r.unnecessaryQuestions > 0))}%|necessaryQuestionsAsked=${pct(rows.filter(r => r.cat === 'necessary-question').map(r => r.questions > 0))}%|modelCallsPerTask=${(rows.reduce((n, r) => n + r.modelCalls, 0) / rows.length).toFixed(2)}|simpleModelCalls=${rows.filter(r => r.cat === 'simple').reduce((n, r) => n + r.modelCalls, 0)}|toolCallsPerTask=${(rows.reduce((n, r) => n + r.toolCalls, 0) / rows.length).toFixed(1)}|approvalViolations=${rows.filter(r => r.approval && r.writesBeforeApproval > 0).length}|localMsP50=${q(rows.map(r => r.ms), 0.5)}|localMsP95=${q(rows.map(r => r.ms), 0.95)}|promptKBPerTask=${(rows.reduce((n, r) => n + (r.promptBytes || 0), 0) / rows.length / 1024).toFixed(1)}|preModelReadsPerModelTask=${(rows.filter(r => r.modelCalls).reduce((n, r) => n + (r.preModelReads || 0), 0) / Math.max(1, rows.filter(r => r.modelCalls).length)).toFixed(1)}`)
  for (const l of lines) console.log(l)
})

const settle = async () => {
  await waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 8000 })
  await new Promise(r => setTimeout(r, 30))
}

describe('UCT Agent evaluation set', () => {
  for (const sc of SCENARIOS) {
    it(sc.id, async () => {
      const board = makeBoard((sc.widgets || ONE_CHART).map(w => ({ ...w, opts: { ...(w.opts || {}) } })), { A: 'AAPL' }, { watchlists: LISTS })
      const { state } = board
      board.host.persist = async () => ({ ok: true })
      board.host.charts.canManageIndicators = () => true
      render(<AgentPanel host={board.host} onClose={() => {}} />)
      await screenerMod.loadMeta()
      await screenerMod.loadOptions?.().catch(() => {})
      const box = screen.getByLabelText('Message UCT Agent')
      await settle()                                     // the welcome finishes typing first
      let ms = 0
      let writesBeforeApproval = null
      let questions = 0
      let modelCalls = 0
      let execMs = 0
      let promptBytes = 0
      let preModelReads = 0
      for (const [text, model] of sc.say) {
        const before = calls.filter(c => c[1] === '/api/agent/turn').length
        const callsBefore = calls.length
        const tracesBefore = (traceMod.lastTraces?.() || []).length
        if (model) turnQueue.push(model)
        await waitFor(() => expect(box.disabled).toBe(false))
        // anything written before the FIRST approval is a gate violation
        if (text === 'do it' && writesBeforeApproval === null) writesBeforeApproval = state.server.calls.filter(c => c[0] !== 'GET').length + (state.boardWrites || 0)
        const t0 = performance.now()
        fireEvent.change(box, { target: { value: text } }); fireEvent.keyDown(box, { key: 'Enter' })
        await settle()
        ms += performance.now() - t0                     // Enter → the panel is idle again (local pipeline only)
        await new Promise(r => setTimeout(r, 120))       // a follow-up step may still be running
        await settle()
        modelCalls += calls.filter(c => c[1] === '/api/agent/turn').length - before
        // phase profile: execution (the Agent's own trace), the request the model would read, reads before it
        const step = calls.slice(callsBefore)
        const firstTurn = step.findIndex(c => c[1] === '/api/agent/turn')
        if (firstTurn >= 0) preModelReads += step.slice(0, firstTurn).filter(c => !/agent\/record/.test(c[1])).length
        for (const c of step) if (c[1] === '/api/agent/turn') promptBytes += JSON.stringify(c[2] || {}).length
        const tr = (traceMod.lastTraces?.() || []).slice(Math.max(0, tracesBefore - ((traceMod.lastTraces?.() || []).length > 9 ? 1 : 0)))
        execMs += tr.reduce((n, t) => n + ((t.marks.find(m => String(m[0]).startsWith('end:')) || [0, 0])[1] || 0), 0)
        turnQueue = []
      }
      writesBeforeApproval = writesBeforeApproval ?? 0
      questions = document.querySelectorAll('[data-testid="agent-question"]').length
      ms = Math.round(ms)
      // UCT work the request caused (warm-up reads every panel makes are left out): Screener scans,
      // session reads, ticker checks, watchlist REST calls, board writes.
      const toolCalls = calls.filter(c => /^\/api\/(screener\/scan|agent\/session-stats|ticker-search)/.test(c[1])).length
        + state.server.calls.length + (state.boardWrites || 0)
      const done = !!sc.done(state)
      rows.push({ id: sc.id, cat: sc.cat, done, modelCalls, toolCalls, questions, unnecessaryQuestions: sc.questionOk ? 0 : questions, writesBeforeApproval, approval: !!sc.approval, ms, execMs: Math.round(execMs), promptBytes, preModelReads })
      cleanup()
    }, 20000)
  }
})
