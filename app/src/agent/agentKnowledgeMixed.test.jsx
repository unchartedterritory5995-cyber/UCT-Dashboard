// Review #768 finding 4: a MIXED chart change + knowledge plan (server: reply dropped, ops kept) shows the change's
// own receipt AND UCT's cited knowledge card, and no model text. Scripted envelope, mocked routes; no model, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { _resetAgentConfig } from './agentClient'
import { _resetKnowledgeForTest } from './capabilities/knowledge'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const SEARCH = { contract: 'MD-1.0', kind: 'knowledge.search', params_echo: {}, status: 'ok', freshness: 'periodic',
  as_of: '2026-11-01T02:00:00Z', fetched_at: '2026-11-03T05:00:00Z', delay_s: null, stale: false, source: 'uct-brain-pack',
  coverage: { pack_ts: 1761962400, policy_version: 3 }, provider_calls: 0, notes: [],
  data: { method: 'fts', passages: [{ kb_id: 2, title: 'UCT team playbook: VCP', category: 'SETUP', trader: 'UCT Team',
    source: 'the UCT team playbook (distilled, unattributed)', licence: 'team_owned', excerpt: 'Tightening pullbacks on drying volume.' }] } }

let envelopes, turnBodies, dataBodies
beforeEach(() => {
  envelopes = []; turnBodies = []; dataBodies = []
  _resetAgentConfig(); _resetKnowledgeForTest()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    const u = String(url)
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: true, scan: false, data_kinds: ['knowledge.search'] })
    if (u === '/api/agent/turn') {
      turnBodies.push(body)
      const e = envelopes.shift()
      return json({ conversationId: 'c1', envelope: typeof e === 'function' ? e(body) : e, usage: {} })
    }
    if (u === '/api/agent/data') { dataBodies.push(body); return json(SEARCH) }
    if (u === '/api/agent/record') return json({ conversationId: 'c1' })
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); _resetKnowledgeForTest() })

const refOf = (b, key) => b.context[key]?.[0]?.ref

describe('review #768: a mixed chart change + knowledge plan', () => {
  it('shows the chart change receipt and the cited knowledge card; no model reply', async () => {
    const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
      { action: 'chart.setType', target: refOf(b, 'charts'), args: { type: 'bars' } },
      { action: 'playbook.explain', target: refOf(b, 'playbook'), args: { question: 'what is a VCP' } },
    ] }))
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 })
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(c => String(c[0]) === '/api/agent/config')).toBe(true))
    fireEvent.change(box, { target: { value: 'make it bars and what is a VCP?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(document.body.textContent).toMatch(/From UCT's knowledge base/), { timeout: 8000 })
    await waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 8000 })
    const t = document.body.textContent
    expect(refOf(turnBodies[0], 'playbook')).toBeTruthy()                       // the knowledge capability was offered
    expect(t).toMatch(/Bars/)                                                   // the change's own receipt
    expect(t).toContain('UCT KB #2')                                            // the cited card
    expect(t).toMatch(/source policy v3/)
    expect(dataBodies.map(b => b.kind)).toEqual(['knowledge.search'])
    expect(board.commits?.length ?? 1).toBeGreaterThan(0)
  })
})
