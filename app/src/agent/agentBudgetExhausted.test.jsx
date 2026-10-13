// UCT Agent — Gate B (Phase 0A/0B, owner 2026-10-13): when paid inference is unavailable — the Agent's
// own $5 budget or the site-wide AI budget is spent, the member is rate-limited, or another request is
// still in flight — the server refuses BEFORE any model call with ONE plain sentence (budget.py /
// limits.py). The panel shows that sentence as it is, changes nothing, and every instant command keeps
// working: deterministic paths never touch the budget. Scripted server; no network, no model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const SENTENCES = {
  agent: "UCT Agent has reached today's AI budget, so I can't interpret new requests until tomorrow. Charts, breadth and other instant commands still work.",
  site: "UCT's AI budget for today has been reached, so UCT Agent can't interpret new requests until tomorrow. Charts, breadth and other instant commands still work.",
  rate: "You're sending requests faster than UCT Agent can take them. Please wait a moment and try again.",
  inflight: 'UCT Agent is still working on your last request. Wait for it to finish, then try again.',
}

describe('paid inference unavailable — one sentence, nothing changed, instant commands still work', () => {
  let turns, records
  beforeEach(() => {
    turns = []; records = []
    try { localStorage.clear() } catch { /* */ }
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function mount(sentence, status = 429) {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
      const body = init.body ? JSON.parse(init.body) : null
      if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(body); return json({ detail: sentence }, status) }
      if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
      if (url === '/api/agent/config') return json({ stream: false })
      if (String(url).startsWith('/api/live-prices')) return json({})
      return json({ conversations: [] })
    })
    const board = makeBoard([{ id: 'l', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'QQQ' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    const say = async (t) => {
      await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
      fireEvent.change(box, { target: { value: t } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    }
    return { say, board }
  }
  const transcript = () => screen.getByTestId('agent-transcript').textContent

  for (const [why, sentence] of Object.entries(SENTENCES)) {
    it(`${why}: the model request is refused in UCT's words; "weekly" still runs instantly`, async () => {
      const { say } = mount(sentence)
      await say('why is the market weak today?')
      await waitFor(() => expect(turns).toHaveLength(1), { timeout: 8000 })
      await waitFor(() => expect(transcript()).toContain(sentence), { timeout: 8000 })
      expect(transcript()).not.toMatch(/\(\d{3}\)|HTTPException|BudgetRefused|agent_cap|site_cap/)
      await say('weekly')
      await waitFor(() => expect(transcript()).toMatch(/Weekly/), { timeout: 8000 })
      expect(turns).toHaveLength(1)                                   // the instant command never asked the server's model
    }, 30000)
  }
})
