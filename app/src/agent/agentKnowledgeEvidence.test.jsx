// E-1 evidence routing (docs/agent/knowledge/EVIDENCE-ROUTING-DESIGN.md), browser half. The server classifies every
// planner turn while Brain is on; the browser needs nothing new, and these pin what it relies on:
//   - deterministic fast-path chart commands never send a turn (so they never wait on, or fail with, the classifier);
//   - E-1's fixed clarify renders UCT's text and enum choices, and a choice is sent as the member's next message;
//   - E-1's need_groups ["playbook"] makes the browser's ONE reroute carry the playbook group, and the read's card shows.
// Scripted envelopes, mocked routes; no model, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { _resetAgentConfig } from './agentClient'
import { _resetKnowledgeForTest } from './capabilities/knowledge'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const PLAYBOOK = { contract: 'MD-1.0', kind: 'setup.playbook', params_echo: {}, status: 'ok', freshness: 'periodic',
  as_of: '2026-11-01T02:00:00Z', fetched_at: '2026-11-03T05:00:00Z', delay_s: null, stale: false, source: 'uct-brain-pack',
  coverage: { pack_ts: 1761962400, policy_version: 5 }, provider_calls: 0, notes: [],
  data: { name: 'Episodic Pivot', aliases: ['EP'], source: 'a UCT team setup template (origin: team)', approved_by_policy: 5,
    description: 'Team-authored template text.', link: { href: '/setup-library', label: 'Open the Setup Library' } } }
const CLARIFY_TEXT = "Do you mean UCT's playbook definition of a setup, or a reading of your chart?"

let envelopes, turnBodies, dataBodies
beforeEach(() => {
  envelopes = []; turnBodies = []; dataBodies = []
  _resetAgentConfig(); _resetKnowledgeForTest()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    const u = String(url)
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: true, scan: false,
      data_kinds: ['knowledge.search', 'setup.playbook', 'setup.record'] })
    if (u === '/api/agent/turn') {
      turnBodies.push(body)
      const e = envelopes.shift()
      return json({ conversationId: 'c1', envelope: typeof e === 'function' ? e(body) : e, usage: {} })
    }
    if (u === '/api/agent/data') { dataBodies.push(body); return json(PLAYBOOK) }
    if (u === '/api/agent/record') return json({ conversationId: 'c1' })
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); _resetKnowledgeForTest() })

const refOf = (b, key) => b.context[key]?.[0]?.ref

async function open() {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 })
  await waitFor(() => expect(globalThis.fetch.mock.calls.some(c => String(c[0]) === '/api/agent/config')).toBe(true))
  const send = (v) => { fireEvent.change(box, { target: { value: v } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { board, send }
}
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 8000 })

describe('E-1: the browser half', () => {
  it('a deterministic fast-path chart command never sends a turn (no classifier on its path)', async () => {
    const { send } = await open()
    send('bars')
    await waitFor(() => expect(document.body.textContent).toMatch(/Bars/), { timeout: 8000 })
    await idle()
    expect(turnBodies).toEqual([])
  })

  it("UCT's fixed clarify shows its text and enum choices; a choice is the member's next message", async () => {
    envelopes.push({ disposition: 'clarify', reply: '', ops: [], unsupported_category: null,
      question: { text: CLARIFY_TEXT, choices: ["UCT's definition of Episodic Pivot", 'Read my chart'] } })
    envelopes.push({ disposition: 'answer', reply: 'ok', ops: [], question: null, unsupported_category: null })
    const { send } = await open()
    send('the EP one')
    await waitFor(() => expect(document.body.textContent).toContain(CLARIFY_TEXT), { timeout: 8000 })
    fireEvent.click(screen.getByRole('button', { name: "UCT's definition of Episodic Pivot" }))
    await waitFor(() => expect(turnBodies.length).toBe(2), { timeout: 8000 })
    expect(turnBodies[1].message).toBe("UCT's definition of Episodic Pivot")
  })

  it("need_groups ['playbook'] reroutes once with the playbook group, and UCT's card answers", async () => {
    envelopes.push({ disposition: 'clarify', reply: '', ops: [], unsupported_category: null,
      question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: ['playbook'] })
    envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
      { action: 'playbook.setup', target: refOf(b, 'playbook'), args: { setup: 'Episodic Pivot' } }] }))
    const { send } = await open()
    send('EP??')
    await waitFor(() => expect(document.body.textContent).toMatch(/From UCT's playbook/), { timeout: 8000 })
    await idle()
    expect(turnBodies.length).toBe(2)
    expect(turnBodies[1].reroute).toBe(true)
    expect(turnBodies[1].routing?.selected || []).toContain('playbook')
    expect(turnBodies[1].capabilities.map(c => c.name)).toContain('playbook.setup')
    expect(dataBodies.map(b => b.kind)).toEqual(['setup.playbook'])
    expect(document.body.textContent).not.toContain('Looking at more of UCT')
  })
})
