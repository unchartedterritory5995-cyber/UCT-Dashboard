// UCT News "Continue in UCT Agent" (newsAsk.openAgent → the workspace's panel request): the panel shows the
// headline's conversation — the server's transcript, as History opens it — asks nothing, and the next message
// continues that same conversation id.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

let turnCalls
const host = { charts: { list: () => [], read: () => null }, otherWidgets: () => [] }
const TRANSCRIPT = { id: 'ac_news_1', title: 'News: NVIDIA REPORTEDLY IN TALKS…', turns: [
  { id: 1, role: 'member', text: 'What does this mean?', data: { news: '01JBX7Q2W9R3T5V7X9Z1B3D5F7' } },
  { id: 2, role: 'agent', text: 'The headline reports talks, citing unnamed sources.', data: { envelope: { disposition: 'answer', reply: 'The headline reports talks, citing unnamed sources.', ops: [] } } },
] }

beforeEach(() => {
  turnCalls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { turnCalls.push(JSON.parse(init.body)); return json({ conversationId: 'ac_news_1', turnId: 3, envelope: { disposition: 'answer', reply: 'Still unconfirmed.', ops: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_news_1' })
    if (url === '/api/agent/conversations/ac_news_1') return json(TRANSCRIPT)
    if (String(url).startsWith('/api/agent/conversations/')) return json({ detail: 'not found' }, 404)
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const tree = (request) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
      <AgentPanel host={host} request={request} onClose={() => {}} />
    </AuthContext.Provider>
  </SWRConfig>
)

describe('Continue in UCT Agent', () => {
  it('an open panel switches to the conversation, asks nothing, and the next message continues it', async () => {
    const r = render(tree(null))
    await act(async () => {})
    r.rerender(tree({ id: 1, kind: 'conversation', conversationId: 'ac_news_1' }))
    await waitFor(() => expect(screen.getByText('The headline reports talks, citing unnamed sources.')).toBeTruthy())
    expect(screen.getByText('What does this mean?')).toBeTruthy()
    expect(turnCalls).toEqual([])
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'Is it confirmed yet?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(turnCalls.length).toBe(1))
    expect(turnCalls[0].conversationId).toBe('ac_news_1')
    expect(turnCalls[0].context?.news).toBeUndefined()        // the server re-reads the headline itself
  })

  it('a conversation the server will not return leaves the panel as it was', async () => {
    const r = render(tree(null))
    await act(async () => {})
    r.rerender(tree({ id: 2, kind: 'conversation', conversationId: 'ac_someone_else' }))
    await act(async () => {})
    expect(screen.queryByText('What does this mean?')).toBeNull()
    expect(turnCalls).toEqual([])
  })
})
