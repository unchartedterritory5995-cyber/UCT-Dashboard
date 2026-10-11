// LIVE-MODEL BATCH — request capture (Phase 2, Milestone 1). Runs ONLY with AGENT_LIVE_OUT set.
//
// Builds the exact /api/agent/turn bodies the panel would send for the live batch (same manifest,
// routing and workspace context), with no model call, and writes them for tools/agent_live_batch.py,
// which sends them to the real model under a hard dollar ceiling. Nothing here executes anything.
import { it, vi } from 'vitest'
import fs from 'node:fs'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import * as screenerMod from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { addInstance } from '../components/chart/engine/instanceControls'
import * as registry from '../components/chart/engine/nativeRegistry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const OUT = globalThis.process?.env?.AGENT_LIVE_OUT
const FIELDS = globalThis.process?.env?.AGENT_LIVE_FIELDS

// id, message, expectation (checked by the harness), and the board it is asked on
export const BATCH = [
  { id: 'tf-15', say: 'Change my chart to 15 minutes.', want: { actions: ['chart.setTimeframe'], args: { timeframe: '15' } } },
  { id: 'tf-15-variant', say: 'can you flip the chart over to the fifteen minute view', want: { actions: ['chart.setTimeframe'], args: { timeframe: '15' } } },
  { id: 'ema-20', say: 'Put a 20 EMA on my chart.', want: { honest: true } },
  { id: 'rsi-remove', say: 'Remove RSI from this chart.', want: { actions: ['indicator.remove'] }, rsi: true },
  { id: 'rsi-remove-variant', say: 'get that RSI off my chart please', want: { actions: ['indicator.remove'] }, rsi: true },
  { id: 'nvda-main', say: 'Open NVDA on my main chart.', want: { actions: ['chart.setSymbol'], args: { symbol: 'NVDA' } } },
  { id: 'software-wl', say: 'Find software stocks over $10 with $10 million in daily dollar volume and make a watchlist.', want: { actions: ['screener.run', 'watchlist.create', 'watchlist.add'], noClarify: true } },
  { id: 'open-created', say: 'Open the watchlist you just created.', want: { actions: ['watchlist.open'] }, history: 'software-wl', made: 'Software Over $10' },
  { id: 'strongest', say: 'Show me my strongest stocks.', want: { actions: ['screener.run', 'screener.runSaved'], noClarify: true } },
  { id: 'trading-layout', say: 'Switch to my trading layout.', want: { actions: ['layout.open'] }, layouts: ['Main Trading', 'Swing Setups'] },
  { id: 'screen-save', say: 'Find stocks with ADR above 5% and price above $20 and save them.', want: { actions: ['screener.run'], noClarify: true } },
  { id: 'vwap-rsi-5m', say: 'Add VWAP and RSI, then change my chart to five minutes.', want: { actions: ['indicator.add', 'chart.setTimeframe'] } },
  { id: 'vwap-rsi-5m-variant', say: 'throw vwap and rsi on there and make it a 5 min chart', want: { actions: ['indicator.add', 'chart.setTimeframe'] } },
  { id: 'strongest-refine', say: 'now only the ones above $50', want: { actions: ['screener.run'], noClarify: true }, history: 'strongest' },
]

it.skipIf(!OUT)('capture the live batch requests', async () => {
  const bodies = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json(JSON.parse(fs.readFileSync(FIELDS, 'utf8')))
    if (url === '/api/screener/fields?options=1') return json({ options: {} })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [{ id: 'starter_momentum_leaders', name: 'Leaders (RS ≥ 90)', spec: {} }, { id: 'starter_stage2_breakout', name: 'Stage-2 breakouts', spec: {} }, { id: 'starter_52w_breakout', name: '52-Week Breakout on Volume', spec: {} }] })
    if (url === '/api/agent/turn') { bodies.push(JSON.parse(init.body)); return json({ conversationId: 'c', envelope: { disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null }, usage: {} }) }
    return json({ conversations: [] })
  })
  for (const b of BATCH) {
    const lists = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'AMD', 'TSLA'] }, { id: 's1', name: 'Swing', symbols: ['MSFT'] }, ...(b.made ? [{ id: 'n1', name: b.made, symbols: ['CRM', 'NOW'] }] : [])]
    const settings = b.rsi ? addInstance(mergeChartSettings(null), 'rsi', registry) : null
    const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, opts: settings ? { settings } : {} }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1' } }], { A: 'AAPL' },
      { watchlists: lists, ...(b.layouts ? { layouts: { entries: b.layouts.map((name, i) => ({ id: i + 1, name })), boards: {}, active: null } } : {}) })
    board.host.charts.canManageIndicators = () => true
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    await screenerMod.loadMeta()
    const box = screen.getByLabelText('Message UCT Agent')
    await waitFor(() => expect(box.disabled).toBe(false))
    // The MODEL's reading is what is measured, so the fast path is bypassed for every request here
    // (`answering` sends straight to the model, as a reply to a question does).
    const n = bodies.length
    const { fastParse } = await import('./fastPath')
    const fast = fastParse(b.say, { host: board.host })
    // force the model path: a leading zero-width space defeats every fast phrase without changing meaning
    fireEvent.change(box, { target: { value: `​${b.say}` } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await new Promise(r => setTimeout(r, 500))
    const body = bodies[n] || null
    if (body) body.message = b.say
    bodies.splice(n)
    fs.appendFileSync(`${OUT}.log`, `${b.id} fast=${fast ? fast.kind : 'model'}\n`)
    bodies.push({ id: b.id, want: b.want, history: b.history || null, fastInProduct: !!(fast && fast.kind === 'ops'), body })
    cleanup()
  }
  fs.writeFileSync(OUT, JSON.stringify(bodies))
}, 120000)
