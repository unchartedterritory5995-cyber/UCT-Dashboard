// INTEGRATED ACCEPTANCE (owner 2026-10-12): Agent Breadth Intelligence × Agent Context "simple
// conversations", in ONE panel session — breadth readings and history follow-ups, explicit multi-chart
// commands with Undo, back to breadth (the subject survives other turns), and a model-planned
// three-universe NH/NL answer with honest labels. ⛔ No breadth value ever reaches a model request.
// Scripted model; breadth routes answer with fixed synthetic payloads; no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { _resetBreadthSubject, _resetBreadthDates } from './capabilities/breadth'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const SENTINELS = ['61.2345', '61.23', '2020-03-23', '+97']
const NHNL = { us: '+97', nasdaq: '+51', nyse: '+11' }
let turns, records, breadthBodies, historyBodies
beforeEach(() => {
  turns = []; records = []; breadthBodies = []; historyBodies = []
  _resetBreadthDates(); _resetBreadthSubject()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') {
      turns.push(body)
      // the only model turn: "net new highs/lows today for US, Nasdaq and NYSE" → three breadth.show ops
      const ref = body.context.breadth[0].ref
      const ops = ['us', 'nasdaq', 'nyse'].map(u => ({ action: 'breadth.show', target: ref,
        args: { mode: 'value', universe: u, metrics: ['net_new_high_low'], date: null, compare_date: null, start: null, end: null, basis: null, side: null, sessions: null } }))
      return json({ conversationId: 'c1', envelope: { disposition: 'apply', reply: '', question: null, ops, unsupported_category: null }, usage: {} })
    }
    if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
    if (url === '/api/agent/breadth') {
      breadthBodies.push(body)
      if (body.metrics?.[0] === 'net_new_high_low') {
        const u = body.universe
        return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: NHNL[u], label: `${u.toUpperCase()} · Net New 52-Week Highs-Lows`,
          note: 'Finalized close · Oct 9. Today’s reading of this measure isn’t validated for UCT Agent yet, so this is the latest finalized close.' } })
      }
      return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: '61.2345%'.replace('2345', ''), label: `${body.universe.toUpperCase()} · % of Stocks Above 200-Day MA`, note: 'Intraday · 11:51 AM ET' } })
    }
    if (url === '/api/agent/breadth/history') {
      historyBodies.push(body)
      return json({ status: 'ok', text: 'Last below 10% on 2020-03-23.', table: null,
        present: { kind: 'value', value: '2020-03-23', label: `${body.universe.toUpperCase()} · % of Stocks Above 200-Day MA · Last below 10.0%`, note: 'Reading 9.4% that session.',
          source: 'Finalized daily closes, 2008-01-02 – 2026-10-09, 4,724 sessions.' } })
    }
    if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-12', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

function mount() {
  const board = makeBoard([{ id: 'l', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'r', type: 'chart', x: 12, y: 0, w: 12, h: 20 }], { A: 'NVDA', B: 'QQQ' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  // send like a member: only once the panel is idle (not busy, no typing indicator), and confirm it was taken
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
  }
  return { board, say }
}
const tfs = (board) => board.state.widgets.map(w => w.opts?.tf || 'D')
const results = () => screen.queryAllByTestId('agent-result')
const transcript = () => screen.getByTestId('agent-transcript').textContent

describe('one session across breadth and chart work', () => {
  it('reading → history → both charts weekly → undo → "same thing for Nasdaq" → NH/NL × 3 (model) — accurate, concise, private', async () => {
    const { board, say } = mount()

    // 1 · today's reading (deterministic)
    await say('What percent of US stocks are above the 200sma?')
    await waitFor(() => expect(results()).toHaveLength(1), { timeout: 8000 })
    expect(results()[0].textContent).toMatch(/Intraday · 11:51 AM ET/)

    // 2 · the history follow-up resolves "that" (deterministic)
    await say('When was the last time that was below 10%?')
    await waitFor(() => expect(results()).toHaveLength(2), { timeout: 8000 })
    expect(historyBodies[0]).toMatchObject({ universe: 'us', metric: 'pct_above_200sma', op: 'below', level: 10, find: 'last' })
    expect(results()[1].textContent).toMatch(/2020-03-23/)

    // 3 · an explicit, reversible multi-chart command runs at once (simple conversations) …
    await say('make both charts weekly')
    await waitFor(() => expect(tfs(board)).toEqual(['W', 'W']), { timeout: 8000 })
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
    // … and Undo puts both back
    await say('undo that')
    await waitFor(() => expect(tfs(board)).toEqual(['D', 'D']), { timeout: 8000 })

    // 4 · back to breadth: the remembered SUBJECT survived the chart turns
    await say('same thing for Nasdaq')
    await waitFor(() => expect(historyBodies).toHaveLength(2), { timeout: 8000 })
    expect(historyBodies[1]).toMatchObject({ universe: 'nasdaq', metric: 'pct_above_200sma', op: 'below', level: 10, find: 'last' })

    expect(turns).toHaveLength(0)                                          // nothing so far needed the model

    // 5 · a model-planned, three-universe NH/NL answer: three separately labelled cards, honest status
    await say('How did the net new highs/lows look today for US, Nasdaq, and NYSE stocks?')
    await waitFor(() => expect(breadthBodies.filter(b => b.metrics[0] === 'net_new_high_low')).toHaveLength(3), { timeout: 8000 })
    await waitFor(() => expect(transcript()).toMatch(/NYSE · Net New 52-Week Highs-Lows/), { timeout: 8000 })
    for (const u of ['US', 'NASDAQ', 'NYSE']) expect(transcript()).toContain(`${u} · Net New 52-Week Highs-Lows`)
    expect(transcript()).not.toMatch(/published from finalized closes only/)
    expect((transcript().match(/isn’t validated for UCT Agent yet/g) || []).length).toBe(3)
    expect(turns).toHaveLength(1)

    // ⛔ privacy: the one model request carried no breadth value or searched date; every breadth row is local
    expect(SENTINELS.filter(s => JSON.stringify(turns).includes(s))).toEqual([])
    // four local rows: the reading, two searches, and ONE row for the model turn's three NH/NL lookups
    await waitFor(() => expect(records.filter(r => r.outcomeData?.local)).toHaveLength(4), { timeout: 8000 })
    expect(records.filter(r => r.outcomeData?.local).at(-1).outcomeData.requests).toHaveLength(3)
    for (const r of records.filter(x => x.outcomeData?.local)) {
      expect(SENTINELS.filter(s => JSON.stringify(r.outcomeData.requests || []).includes(s))).toEqual([])
    }
  }, 40000)
})
