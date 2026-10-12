// DETERMINISTIC breadth routing (2026-10-12): the obvious present-tense, explicit-close and overview
// questions are planned by breadth.show's own fast phrase — the SAME registry op through the same
// planner / policy / runtime and the same local-only answer, with no model call. Anything with a date,
// a weekday, a second request or other words still goes to the model. Scripted routes, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { breadthFast, _resetBreadthDates } from './capabilities/breadth'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const ARGS = (metrics, basis = null, universe = 'us') => ({ mode: 'value', universe, metrics, date: null, compare_date: null, start: null, end: null, basis })

describe('the phrases: obvious wording only', () => {
  it.each([
    ["How's breadth today?", ARGS([])],
    ["what's breadth right now", ARGS([])],
    ['How is market breadth looking?', ARGS([])],
    ['breadth', ARGS([])],
    ["How's Nasdaq breadth today?", ARGS([], null, 'nasdaq')],
    ['What percentage of stocks are above their 50-day?', ARGS(['pct_above_50sma'])],
    ['What % of stocks are above the 200-day moving average right now?', ARGS(['pct_above_200sma'])],
    ['what % of nasdaq stocks are above their 20 day', ARGS(['pct_above_20sma'], null, 'nasdaq')],
    ['% above 50 day on the nyse today', ARGS(['pct_above_50sma'], null, 'nyse')],
    ['What was the % above the 50-day at the latest close?', ARGS(['pct_above_50sma'], 'close')],
    ["how's breadth at the close", ARGS([], 'close')],
  ])('%s → planned locally', (q, args) => { expect(breadthFast(q)).toEqual(args) })

  it.each([
    "What's breadth today and the latest NVDA news?",              // a second request
    'what was breadth on october 8',                               // a date
    'what % of stocks were above the 50-day on Friday',            // a weekday
    "what was breadth at yesterday's close",                       // a relative date
    '% above the 30-day',                                          // no such measure
    'how does breadth compare with a month ago',                   // a comparison
    'why is breadth so weak today',                                // an explanation
    'show breadth from september 1 to today',                      // a range
  ])('%s → the model', (q) => { expect(breadthFast(q)).toBeNull() })

  it('the fast path returns the registry op (whole message, no target guessing)', () => {
    expect(fastParse("How's breadth today?")).toEqual({ kind: 'ops', ops: [{ action: 'breadth.show', args: ARGS([]) }], target: null })
  })
})

describe('through the panel: no model call, the same local-only answer', () => {
  let turns, records, breadthBodies
  beforeEach(() => {
    turns = []; records = []; breadthBodies = []
    _resetBreadthDates()
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      const body = init.body ? JSON.parse(init.body) : null
      if (url === '/api/agent/turn') { turns.push(body); return json({ conversationId: 'c1', envelope: { disposition: 'answer', reply: 'model', question: null, ops: [], unsupported_category: null }, usage: {} }) }
      if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
      if (url === '/api/agent/breadth') {
        breadthBodies.push(body)
        return json({ status: 'ok', text: 'US breadth now: …', table: null,
          present: { kind: 'value', value: '61.2%', label: 'US · % of Stocks Above 50-Day MA', note: 'Intraday · 11:51 AM ET' } })
      }
      if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-12', latest_finalized: { us: '2026-10-08', nyse: '2026-10-08', nasdaq: '2026-10-08' } })
      if (String(url).startsWith('/api/live-prices')) return json({})
      return json({ conversations: [] })
    })
  })
  afterEach(() => { vi.restoreAllMocks() })
  const mount = () => {
    const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    return async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  }

  it.each([
    ['What percentage of stocks are above their 50-day?', ARGS(['pct_above_50sma'])],
    ["How's breadth today?", ARGS([])],
    ['What was the % above the 50-day at the latest close?', ARGS(['pct_above_50sma'], 'close')],
  ])('%s', async (q, args) => {
    const say = mount()
    await say(q)
    await screen.findByTestId('agent-result', {}, { timeout: 6000 })
    expect(turns).toHaveLength(0)                                                  // no model call
    expect(breadthBodies).toEqual([args])
    await waitFor(() => expect(records.some(r => r.outcomeData?.local)).toBe(true), { timeout: 6000 })
    const row = records.find(r => r.outcomeData?.local)
    expect(row.outcomeData.actions).toEqual(['breadth.show'])
    // ⛔ the row the server replays to a model holds the request args, never the figure in its text
    expect(JSON.stringify(row.outcomeData.requests)).not.toMatch(/61\.2/)
  })

  it('a mixed request still goes to the model (all-or-nothing)', async () => {
    const say = mount()
    await say("What's breadth today and the latest NVDA news?")
    await waitFor(() => expect(turns).toHaveLength(1), { timeout: 6000 })
    expect(breadthBodies).toHaveLength(0)
  })
})
