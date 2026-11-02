// UCT News → UCT Agent (agent-lead, owner-authorized increments 2–3): the public seam News builds against —
// useAgentAsk({newsId}) → {ask, turns, busy, error, conversationId}, openAgent({conversationId}), AgentIdentity,
// canUseAgent. Only the headline's id is sent; the thread survives unmount; a retry is not shown twice; the
// panel opens on the conversation the thread created.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

vi.mock('./agentClient', () => ({ agentTurn: vi.fn(), agentConversation: vi.fn(), loadAgentConfig: vi.fn(), serverNewsState: vi.fn() }))
import { agentTurn, agentConversation, loadAgentConfig, serverNewsState } from './agentClient'
import { useAgentAsk, openAgent, canUseAgent, AgentIdentity, NEWS_ASK_MAX, _resetNewsAsk } from './newsAsk'
import { AGENT_CONVERSATION_KEY, AGENT_FLAG_KEY, AGENT_OPEN_EVENT, AGENT_OPEN_KEY } from './agentFlag'

const ID = '01JBX7Q2W9R3T5V7X9Z1B3D5F7'
let api
function Probe({ newsId }) {
  api = useAgentAsk({ newsId })
  return (
    <div>
      {api.turns.map(t => <p key={t.id} data-role={t.role}>{t.text}</p>)}
      {api.busy && <span>busy</span>}
      {api.error && <span data-retry={String(api.error.retry)}>{api.error.text}</span>}
    </div>
  )
}
const ok = (reply, conversationId = 'ac_news_1') => ({ ok: true, data: { conversationId, envelope: { disposition: 'answer', reply, ops: [] } } })

beforeEach(() => {
  _resetNewsAsk()
  localStorage.clear()
  agentTurn.mockReset()
  agentConversation.mockReset().mockResolvedValue(null)
  loadAgentConfig.mockReset().mockResolvedValue(false)
  serverNewsState.mockReset().mockReturnValue(true)
})
afterEach(() => cleanup())

describe('useAgentAsk', () => {
  it('sends ONLY the headline id and the question, and shows the answer as plain text', async () => {
    agentTurn.mockResolvedValue(ok('The headline reports talks, citing unnamed sources.'))
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('  What does this mean?  ') })
    expect(agentTurn).toHaveBeenCalledTimes(1)
    expect(agentTurn.mock.calls[0][0]).toEqual({ message: 'What does this mean?', conversationId: null, context: { news: { id: ID } } })
    expect(api.turns.map(t => [t.role, t.text])).toEqual([['member', 'What does this mean?'], ['agent', 'The headline reports talks, citing unnamed sources.']])
    expect(new Set(api.turns.map(t => t.id)).size).toBe(2)
    expect(api.conversationId).toBe('ac_news_1')
    expect(api.busy).toBe(false)
  })

  it('continues the same conversation, and the thread survives unmount and remount', async () => {
    agentTurn.mockResolvedValueOnce(ok('first')).mockResolvedValueOnce(ok('second'))
    const { unmount } = render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('one') })
    const ids = api.turns.map(t => t.id)
    unmount()
    render(<Probe newsId={ID} />)
    expect(api.turns.map(t => t.id)).toEqual(ids)
    await act(async () => { await api.ask('two') })
    expect(agentTurn.mock.calls[1][0].conversationId).toBe('ac_news_1')
    expect(screen.getAllByText(/first|second/)).toHaveLength(2)
  })

  it('keeps headlines apart', async () => {
    agentTurn.mockResolvedValue(ok('a'))
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('one') })
    cleanup()
    render(<Probe newsId="01JBX7Q2W9R3T5V7X9Z1B3D5F8" />)
    expect(api.turns).toEqual([])
    expect(api.conversationId).toBe(null)
  })

  it('shows busy while the answer is on its way, and ignores a second ask meanwhile', async () => {
    let release
    agentTurn.mockReturnValue(new Promise((r) => { release = r }))
    render(<Probe newsId={ID} />)
    let p
    act(() => { p = api.ask('one') })
    expect(screen.getByText('busy')).toBeTruthy()
    await act(async () => { await api.ask('two') })
    expect(agentTurn).toHaveBeenCalledTimes(1)
    await act(async () => { release(ok('done')); await p })
    expect(api.busy).toBe(false)
  })

  it('a failure is a sentence with Retry; the retried question is not shown twice', async () => {
    agentTurn.mockResolvedValueOnce({ ok: false, status: 503, error: 'UCT Agent is unavailable right now.' })
      .mockResolvedValueOnce(ok('answered'))
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('one') })
    expect(api.error).toEqual({ text: 'UCT Agent is unavailable right now.', retry: true })
    await act(async () => { await api.ask('one') })
    expect(api.error).toBe(null)
    expect(api.turns.map(t => t.role)).toEqual(['member', 'agent'])
  })

  it.each([[403], [404], [422], [400]])('a %s refusal is final (no Retry)', async (status) => {
    agentTurn.mockResolvedValue({ ok: false, status, error: "UCT Agent can't discuss headlines yet." })
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('one') })
    expect(api.error).toEqual({ text: "UCT Agent can't discuss headlines yet.", retry: false })
  })

  it('refuses an over-long question in the browser without a request', async () => {
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('x'.repeat(NEWS_ASK_MAX + 1)) })
    expect(agentTurn).not.toHaveBeenCalled()
    expect(api.error.retry).toBe(false)
    await act(async () => { await api.ask('   ') })
    expect(agentTurn).not.toHaveBeenCalled()
  })

  it('a reload restores today\'s chat for this headline from the server transcript', async () => {
    agentTurn.mockResolvedValue(ok('first'))
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('one') })
    cleanup()
    _resetNewsAsk()                                          // a reload: the in-memory thread is gone
    agentConversation.mockResolvedValue({ turns: [
      { id: 7, role: 'member', text: 'one' }, { id: 8, role: 'agent', text: 'first' },
      { id: 9, role: 'outcome', text: 'Refused: x' }] })
    await act(async () => { render(<Probe newsId={ID} />) })
    expect(agentConversation).toHaveBeenCalledWith('ac_news_1')
    expect(api.turns).toEqual([{ id: 'nr7', role: 'member', text: 'one' }, { id: 'nr8', role: 'agent', text: 'first' }])
    expect(api.conversationId).toBe('ac_news_1')
  })

  it('a chat the server will not return (another member\'s, deleted) restores nothing', async () => {
    agentTurn.mockResolvedValue(ok('first'))
    render(<Probe newsId={ID} />)
    await act(async () => { await api.ask('one') })
    cleanup()
    _resetNewsAsk()
    await act(async () => { render(<Probe newsId={ID} />) })
    expect(agentConversation).toHaveBeenCalledWith('ac_news_1')
    expect(api.turns).toEqual([])
    expect(api.conversationId).toBe(null)
  })
})

describe('available', () => {
  it('null while the config loads, then what it reports — from ONE shared config read for every headline', async () => {
    let state = null
    let answer
    serverNewsState.mockImplementation(() => state)
    loadAgentConfig.mockReturnValue(new Promise((r) => { answer = r }))
    const seen = {}
    function Two() {
      seen.a = useAgentAsk({ newsId: ID }).available
      seen.b = useAgentAsk({ newsId: '01JBX7Q2W9R3T5V7X9Z1B3D5F8' }).available
      return null
    }
    render(<Two />)
    expect(seen).toEqual({ a: null, b: null })
    expect(loadAgentConfig).toHaveBeenCalledTimes(1)
    state = true
    await act(async () => { answer(false) })
    expect(seen).toEqual({ a: true, b: true })
  })

  it.each([[false, 'news off or no Agent'], [true, 'news on']])('is %s when the config says so (%s)', async (state) => {
    serverNewsState.mockReturnValue(state)
    render(<Probe newsId={ID} />)
    expect(api.available).toBe(state)
    expect(loadAgentConfig).not.toHaveBeenCalled()
  })
})

describe('openAgent', () => {
  it('does nothing without the Agent switch', () => {
    const seen = vi.fn()
    window.addEventListener(AGENT_OPEN_EVENT, seen)
    openAgent({ conversationId: 'ac_news_1' })
    window.removeEventListener(AGENT_OPEN_EVENT, seen)
    expect(seen).not.toHaveBeenCalled()
    expect(localStorage.getItem(AGENT_CONVERSATION_KEY)).toBe(null)
  })

  it('on /charts: stores the chat, marks the panel open and asks the workspace to show it', () => {
    localStorage.setItem(AGENT_FLAG_KEY, '1')
    window.history.pushState({}, '', '/charts')
    const seen = vi.fn()
    window.addEventListener(AGENT_OPEN_EVENT, seen)
    openAgent({ conversationId: 'ac_news_1' })
    openAgent({ conversationId: '' })
    openAgent({})
    window.removeEventListener(AGENT_OPEN_EVENT, seen)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0].detail).toEqual({ conversationId: 'ac_news_1' })
    expect(localStorage.getItem(AGENT_CONVERSATION_KEY)).toBe('ac_news_1')
    expect(localStorage.getItem(AGENT_OPEN_KEY)).toBe('1')
  })
})

describe('AgentIdentity and canUseAgent', () => {
  it('draws the mark at 14–16px with the name', () => {
    const { container } = render(<AgentIdentity size={40} />)
    expect(container.textContent).toBe('UCT Agent')
    const mark = container.querySelector('[aria-hidden="true"]')
    expect(mark.style.width).toBe('16px')
    cleanup()
    const small = render(<AgentIdentity size={10} label={false} />).container
    expect(small.textContent).toBe('')
    expect(small.querySelector('[aria-hidden="true"]').style.width).toBe('14px')
  })

  it('is admin + switch only', () => {
    expect(canUseAgent({ role: 'admin' })).toBe(false)
    localStorage.setItem(AGENT_FLAG_KEY, '1')
    expect(canUseAgent({ role: 'admin' })).toBe(true)
    expect(canUseAgent({ role: 'member' })).toBe(false)
    expect(canUseAgent(null)).toBe(false)
  })
})
