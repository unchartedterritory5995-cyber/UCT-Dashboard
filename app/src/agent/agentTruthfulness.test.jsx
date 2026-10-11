// EXECUTION TRUTHFULNESS — what is deterministic today (docs/agent/PHASE2.md, stabilization review).
// A COMPLETED action is reported ONLY by a receipt built from the read-back state (runtime.commitPlan →
// kind.landed). Model text can never become a receipt. (The model's free-text `reply` / question is
// checked server-side for completion claims — tests/test_uct_agent_honest_replies.py.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let envelopes
beforeEach(() => {
  envelopes = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const b = JSON.parse(init.body); const e = envelopes.shift()
      return json({ conversationId: 'c', envelope: typeof e === 'function' ? e(b) : e, usage: {} })
    }
    return json(url === '/api/agent/record' ? { conversationId: 'c' } : { conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const claim = (ref, tf) => ({ disposition: 'apply', reply: "I've switched your chart to 15 minutes.", question: null, unsupported_category: null,
  ops: [{ action: 'chart.setTimeframe', target: ref, args: { timeframe: tf } }] })

async function mount({ loseWrites = false } = {}) {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  if (loseWrites) board.host.charts.commit = () => true          // says "ok", stores nothing (a lost write)
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, say }
}
const tf = (state) => state.widgets.find(w => w.id === 'c1').opts?.tf || 'D'

describe('a completed action is claimed ONLY by a read-back receipt — never by model text', () => {
  it('the write LANDS: the receipt comes from the read-back state', async () => {
    const { state, say } = await mount()
    envelopes.push((b) => claim(b.context.charts[0].ref, '15'))
    await say('could you flip the chart over to the fifteen minute view')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect(tf(state)).toBe('15')
    expect(r.textContent).toMatch(/Switched timeframe to 15/)
  })
  it('the write is LOST: no receipt, no Undo, a refusal saying it did not take effect — whatever the model said', async () => {
    const { state, say } = await mount({ loseWrites: true })
    envelopes.push((b) => claim(b.context.charts[0].ref, '15'))
    await say('could you flip the chart over to the fifteen minute view')
    await waitFor(() => expect(screen.getByTestId('agent-transcript').textContent).toMatch(/didn't take effect|did not take effect/), { timeout: 6000 })
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
    expect(document.querySelector('[data-undoable]')).toBeNull()
    expect(tf(state)).toBe('D')
  })
})
