// UCT Agent — P2-A2, the SECOND lock: even if a reply with no apply / propose disposition got past
// agentClient.turnReply (here the client is replaced so it does), useAgent never hands its ops to the planner.
// (Before P2-A2 a reply with an unknown or missing disposition that carried ops RAN them.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'

let reply
vi.mock('./agentClient', async (orig) => ({
  ...(await orig()),
  agentTurn: vi.fn(async (body) => ({ ok: true, data: reply(body) })),
  agentTurnStream: vi.fn(async (body) => ({ ok: true, data: reply(body) })),
  agentRecord: vi.fn(async () => ({ ok: true, data: { conversationId: 'c1' } })),
}))
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart ${id}`)?.ref
const plan = (disposition) => (body) => ({ conversationId: 'c1', usage: {}, envelope: { disposition, reply: '', question: null, ops: [{ action: 'chart.setTimeframe', target: refOf(body, 'L'), args: { timeframe: 'W' } }] } })

describe('the execution-point lock', () => {
  it.each([['execute'], [undefined], ['APPLY']])('disposition %s carrying a plan → UCT\'s error, nothing runs', async (d) => {
    const b = makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'NVDA' })
    reply = plan(d)
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'set this chart up for swing trading' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('agent-transcript').textContent).toMatch(/couldn't complete that request\. No changes were made/), { timeout: 8000 })
    expect(b.host.charts.read('L').tf).toBe('D')
  })

  it('apply still runs (the lock admits the two plan dispositions)', async () => {
    const b = makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'NVDA' })
    reply = plan('apply')
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'set this chart up for swing trading' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(b.host.charts.read('L').tf).toBe('W'), { timeout: 8000 })
  })
})
