// UCT AGENT LATENCY BENCHMARK — where a member's wait goes, per request category (local, no paid calls).
//
// The REAL panel, fast path, router, planner, runtime, receipts and Undo run against a production-shaped
// host: the cross-session board check reads /api/auth/preferences and the board's save acknowledgement
// writes it (both through fetch, as host.js does in production). EVERY network request is simulated: it
// waits a fixed HOP_MS and answers from fixtures; the model is scripted. So this measures the SYSTEM —
// how many network waits stand between Enter and the first useful output, in what order, plus the
// browser's own work — never real network, server or model latency (see docs/agent/LATENCY.md for the
// projection with production parameters).
//
// Per turn: visible (first visible feedback), output (first useful output), done (panel idle), the
// critical-path network waits before the output (`hops`, serial count), their endpoints, model calls,
// and local ms (output − time spent waiting on the network). Cold = the first request of its kind after
// the panel opens; warm = the same kind again in the same session.
// `AGENT_LATENCY_OUT=<file>` also writes the rows as JSON.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import { registerBuiltins } from './builtins'
import * as screenerMod from './capabilities/screener'
import * as watchlistMod from './capabilities/watchlist'
import { _resetBreadthDates } from './capabilities/breadth'
import * as agentClient from './agentClient'
import { makeBoard } from './__fixtures__/board'
import { buildBoardSync, boardSig } from './host'
import { lastTurns, _resetTurns } from './trace'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

const HOP_MS = Number(globalThis.process?.env?.AGENT_LATENCY_HOP_MS || 25)
const STREAM = globalThis.process?.env?.AGENT_LATENCY_STREAM === '1'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// SIMULATED model generation (scaled ms — NOT real latency): a call spends GEN.ttft before its first
// token and GEN.perChar per reply character; a researched answer is a short placeholder call, the web
// search (GEN.research) and a second call. The SAME generation model serves /turn and /turn/stream, so
// the two modes differ only in WHEN the member sees text. With streaming, the server's gate is mirrored:
// an answer's reply streams once GEN.hold characters exist (turn.STREAM_HOLD); anything else arrives whole.
const GEN = { ttft: 30, perChar: 0.12, research: 60, hold: 160, chunk: 24 }
const genMs = (reply) => GEN.ttft + Math.max(40, String(reply || '').length) * GEN.perChar
const LONG = 'RSI measures the speed and size of recent price changes on a 0 to 100 scale. Readings above 70 are often called overbought and below 30 oversold, but in strong trends it can stay extreme for weeks, so traders read it with trend and structure. A divergence, price making a new high while RSI does not, hints that momentum is fading. Use it as context, never alone; confirm with volume and the higher-timeframe trend before acting on it. (synthetic)'

let calls = []           // [method, url, t0, t1]
let turnQueue = []
let boardState = null
const bodies = []        // the /api/agent/turn requests, for the server-side prompt-size profile
let currentCat = null
function installFetch() {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    const row = [method, u, performance.now(), null]
    calls.push(row)
    await sleep(HOP_MS)
    row[3] = performance.now()          // a model turn moves its own end (generation, below)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/auth/preferences' && method === 'GET') {
      return json({ charts_workspace_layout: JSON.stringify({ widgets: boardState.widgets }), charts_active_template: JSON.stringify({ id: 1, scope: 'user' }) })
    }
    if (u === '/api/auth/preferences') return json({ ok: true })
    if (u === '/api/agent/config') return json({ stream: STREAM })
    if (u === '/api/agent/turn' || u === '/api/agent/turn/stream') {
      bodies.push({ cat: currentCat, text: body.message, body })
      const f = turnQueue.shift()
      const env = f ? f(body) : { disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null }
      const final = { conversationId: 'ac_bench', envelope: env, usage: { research_calls: f?.research ? 1 : 0, model_calls: f?.modelCalls || 1, citations: [] } }
      const before = f?.research ? genMs('Let me look that up.') : 0
      if (u === '/api/agent/turn') {
        await sleep(before + (f?.research ? GEN.research : 0) + genMs(env.reply))
        row[3] = performance.now()
        return json(final)
      }
      const enc = new TextEncoder()
      const streams = env.disposition === 'answer' && String(env.reply || '').length >= GEN.hold
      const sse = new ReadableStream({
        async start(c) {
          const send = (o) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
          // ABSOLUTE deadlines on the same generation timeline as /turn (timer overhead never accumulates)
          const t0 = performance.now()
          const at = (ms) => sleep(Math.max(0, t0 + ms - performance.now()))
          c.enqueue(enc.encode(': open\n\n'))
          let base = 0
          if (f?.research) { await at(before); send({ t: 'status', stage: 'research' }); base = before + GEN.research }
          if (streams) {
            await at(base + GEN.ttft + GEN.hold * GEN.perChar)
            send({ t: 'delta', text: env.reply.slice(0, GEN.hold) })
            for (let i = GEN.hold; i < env.reply.length; i += GEN.chunk) {
              await at(base + GEN.ttft + Math.min(i + GEN.chunk, env.reply.length) * GEN.perChar)
              send({ t: 'delta', text: env.reply.slice(i, i + GEN.chunk) })
            }
          }
          await at(base + genMs(env.reply))
          row[3] = performance.now()
          send({ t: 'final', ...final })
          c.close()
        },
      })
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_bench' })
    if (u === '/api/agent/breadth/dates') return json({ today_et: '2026-10-12', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
    // synthetic figures only (this file never sees real breadth)
    if (u === '/api/agent/breadth') return json({ status: 'ok', text: 'Breadth (synthetic): 1.0%.', table: null, present: null })
    if (u.startsWith('/api/ticker-search')) {
      const q = new URL(u, 'http://x').searchParams.get('q')
      return json({ results: ['NVDA', 'AMD', 'AAPL', 'TSLA'].includes(q) ? [{ ticker: q }] : [] })
    }
    if (u.startsWith('/api/fundamentals-full/')) return json({ ticker: 'NVDA', name: 'Synthetic Co', market_cap: 1 })
    if (u.startsWith('/api/live-prices')) return json({ NVDA: { price: 1, change_pct: 0 } })
    if (u === '/api/screener/fields') return json({ fields: [] })
    if (u.startsWith('/api/screener/saved-screens')) return json({ saved: [], starters: [] })
    return json({ conversations: [], options: {} })
  })
}

// ── the scripted model (plans what a correct model returns for these words) ──
const env = (disposition, ops, reply = '', question = null) => ({ disposition, reply, question, ops, unsupported_category: null })
const ref = (body, key, i = 0) => body.context[key]?.[i]?.ref
const listRef = (body, name) => (body.context.watchlists || []).find(l => l.name === name)?.ref
const breadthPlan = (args) => (b) => env('apply', [{ action: 'breadth.show', target: ref(b, 'breadth'), args: { mode: 'value', universe: 'us', metrics: [], date: null, compare_date: null, start: null, end: null, basis: null, ...args } }])
const profile = (sym) => (b) => env('apply', [{ action: 'stock.profile', target: ref(b, 'stockData'), args: { symbol: sym } }])
const research = () => Object.assign(() => env('answer', [], LONG), { research: true, modelCalls: 2 })
const explain = () => env('answer', [], LONG)
const clarifyList = () => env('clarify', [], '', { text: 'Which watchlist?', choices: ['Momentum', 'Swing'] })
const deleteList = (name) => (b) => env('propose', [{ action: 'watchlist.delete', target: listRef(b, name), args: {} }])

const ONE_CHART = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, opts: { settings: JSON.stringify({ chartType: 'bars' }) } }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1', watchName: 'Momentum', watchTab: 'mine' } }]
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }, { id: 'o1', name: 'Old Ideas', symbols: ['AMD'] }]

// [category, cold turn, warm turn]; a turn = [text, scripted model | null]
const CATEGORIES = [
  ['timeframe', ['switch to weekly'], ['switch to daily']],
  ['symbol', ['switch to NVDA'], ['switch to AMD']],
  ['indicator', ['add RSI'], ['add VWAP']],
  ['undo', ['undo', null, ['switch to weekly']], ['undo', null, ['switch to monthly']]],
  ['breadth-current', ["how's breadth today?"], ['what % of stocks are above their 50-day?']],
  ['breadth-historical', ['what was breadth on september 15?', breadthPlan({ date: '2026-09-15' })], ['how did breadth look on october 1?', breadthPlan({ date: '2026-10-01' })]],
  ['market-data', ["what's NVDA's market cap?", profile('NVDA')], ["what's AMD's P/E?", profile('AMD')]],
  ['research', ['why is NVDA moving today?', research()], ['what did AMD say on its earnings call?', research()]],
  ['explain', ['explain RSI divergence in detail', explain], ['how do bull flags work?', explain]],
  ['clarify', ['delete my watchlist', clarifyList], ['clear my list', clarifyList]],
  ['approval', ['delete the Swing watchlist', deleteList('Swing')], ['delete the Old Ideas watchlist', deleteList('Old Ideas')]],
  ['approval-apply', ['do it', null, ['delete the Swing watchlist', deleteList('Swing')]], ['do it', null, ['delete the Old Ideas watchlist', deleteList('Old Ideas')]]],
]

// ⛔ REGRESSION BUDGETS — the most serial network waits before the first useful output, and the exact
// model calls, per category (warm). A change that adds a wait or a model call to one of these fails here.
// Deterministic commands: the cross-session board read + the save acknowledgement (2) — a symbol's
// ticker check runs BESIDE the board read; an indicator change is saved once (its own commit).
const BUDGET = {
  timeframe: { hops: 2, model: 0 }, symbol: { hops: 2, model: 0 }, indicator: { hops: 2, model: 0 }, undo: { hops: 2, model: 0 },
  'breadth-current': { hops: 1, model: 0 }, 'breadth-historical': { hops: 2, model: 1 }, 'market-data': { hops: 2, model: 1 },
  research: { hops: 1, model: 1 }, explain: { hops: 2, model: 1 }, clarify: { hops: 1, model: 1 }, approval: { hops: 1, model: 1 },
  'approval-apply': { hops: 0, model: 0 },
}

const rows = []
beforeEach(() => {
  screenerMod._resetScreenerCache()
  watchlistMod._resetLastCreated?.()
  _resetBreadthDates()
  agentClient._resetKnownTickers()
  agentClient._resetAgentConfig?.()          // (absent on a build before streaming: the same bench runs there)
  _resetTurns()
  try { localStorage.clear() } catch { /* */ }
  calls = []; turnQueue = []
  installFetch()
})
afterAll(() => {
  const out = globalThis.process?.env?.AGENT_LATENCY_OUT
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2))
  const bodiesOut = globalThis.process?.env?.AGENT_LATENCY_BODIES
  if (bodiesOut) fs.writeFileSync(bodiesOut, JSON.stringify(bodies))
  for (const r of rows) {
    console.log(`LAT|${STREAM ? 'stream' : 'plain'}|${r.cat}|${r.temp}|path=${r.path}|visible=${r.visible}|output=${r.output}(${r.outputRole})|done=${r.done}|hops=${r.hops}|net=${r.netMs}|local=${r.localMs}|model=${r.modelCalls}|finalLag=${r.finalLag ?? '-'}|seq=${r.seq.join('>')}`)
  }
})

const settle = async () => {
  await waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
  await sleep(20)
}

// Serial network waits between t0 and tEnd: the union of the request intervals (record() is never
// awaited by a turn — it is excluded), and the count of maximal overlapping groups (= serial hops).
function criticalPath(t0, tEnd) {
  const iv = calls.filter(c => c[1] !== '/api/agent/record' && c[1] !== '/api/agent/config' && c[2] >= t0 - 1 && c[2] <= tEnd)
    .map(c => [c[2], Math.min(c[3] ?? tEnd, tEnd), `${c[0] === 'GET' ? '' : `${c[0]} `}${c[1].split('?')[0]}`])
    .sort((a, b) => a[0] - b[0])
  let net = 0; let hops = 0; let end = -Infinity; const seq = []
  for (const [s, e, name] of iv) {
    if (s >= end) { hops += 1; net += e - s; end = e; seq.push(name) } else { if (e > end) { net += e - end; end = e } seq[seq.length - 1] += `+${name}` }
  }
  return { net: Math.round(net), hops, seq }
}

async function say(box, text, model) {
  if (model) turnQueue.push(model)
  await waitFor(() => expect(box.disabled).toBe(false))
  const before = calls.length
  const turnsBefore = lastTurns().length
  const t0 = performance.now()
  fireEvent.change(box, { target: { value: text } }); fireEvent.keyDown(box, { key: 'Enter' })
  await settle()
  const t = lastTurns().slice(turnsBefore).find(x => x.kind === 'send')
  const step = calls.slice(before)
  const out = t?.output ?? t?.done ?? 0
  const cp = criticalPath(t0, t0 + out)
  turnQueue = []
  return {
    path: t?.path || 'local', visible: t?.visible, output: t?.output, outputRole: t?.outputRole, done: t?.done,
    hops: cp.hops, netMs: cp.net, localMs: Math.max(0, Math.round(out - cp.net)), seq: cp.seq,
    modelCalls: step.filter(c => c[1].startsWith('/api/agent/turn')).length,
    // the browser's time from the server's LAST model byte (the final event) to the panel being idle
    finalLag: (() => { const m = step.filter(c => c[1].startsWith('/api/agent/turn')).pop(); return m && t?.done != null ? Math.round(t0 + t.done - m[3]) : null })(), requests: step.filter(c => c[1] !== '/api/agent/record').length,
  }
}

describe('UCT Agent latency benchmark', () => {
  for (const [cat, cold, warm] of CATEGORIES) {
    it(cat, async () => {
      currentCat = cat
      const board = makeBoard(ONE_CHART.map(w => ({ ...w, opts: { ...(w.opts || {}) } })), { A: 'AAPL' }, { watchlists: LISTS })
      boardState = board.state
      // ⭐ production-shaped persistence (host.js): the cross-session check and the save acknowledgement
      board.host.epoch = () => 'user:1'
      board.host.boardInSync = buildBoardSync({ readServer: async () => {
        const r = await fetch('/api/auth/preferences', { credentials: 'include', cache: 'no-store' })
        const p = await r.json()
        return { sig: boardSig(JSON.parse(p.charts_workspace_layout).widgets), epoch: 'user:1' }
      }, localLayout: () => board.state, localEpoch: () => 'user:1' })
      board.host.persist = async () => { await fetch('/api/auth/preferences', { method: 'PUT', body: '{}' }); return { ok: true } }
      board.host.charts.canManageIndicators = () => true
      render(<AgentPanel host={board.host} onClose={() => {}} />)
      const box = screen.getByLabelText('Message UCT Agent')
      await settle()                                      // the welcome finishes typing first
      for (const [temp, [text, model, setup]] of [['cold', cold], ['warm', warm]]) {
        if (setup) await say(box, setup[0], setup[1])   // e.g. the change an Undo undoes
        const r = await say(box, text, model)
        rows.push({ mode: STREAM ? 'stream' : 'plain', cat, temp, ...r })
        expect(r.output).not.toBeNull()                   // every request produced a useful output
        if (temp === 'warm') {
          expect(r.modelCalls).toBe(BUDGET[cat].model)
          expect(r.hops).toBeLessThanOrEqual(BUDGET[cat].hops)
        }
      }
      cleanup()
    }, 30000)
  }
})
