// W2 follow-ups (review-728-741 #1–#3): for a member nothing changes — no registration, no extra render,
// no saved-screens request from the Agent's screener host — and a crashing panel stays inside its dock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { AGENT_FLAG_KEY, AGENT_OPEN_KEY } from './agentFlag'
import AgentProvider, { AgentDockButton } from './AgentProvider'
import { useAgentPageHost } from './agentApp'
import { useScreenerAgentHost } from './hosts/usePageAgentHosts'

vi.mock('./AgentPanel', () => ({ default: () => { throw new Error('panel boom') } }))

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async () => json({ saved: [], starters: [] }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const HOST = { surface: 'breadth', location: () => '/breadth' }
const counter = { renders: 0 }
const onRender = () => { counter.renders += 1 }
function Page() {
  onRender()
  useAgentPageHost('breadth', HOST)
  return <div data-testid="page"><AgentDockButton /></div>
}
function ScreenerPage() {
  useScreenerAgentHost({ rows: [], total: 0, filters: [], loading: false })
  return <div data-testid="screener"><AgentDockButton /></div>
}
const tree = (user, page) => (
  <MemoryRouter>
    <AuthContext.Provider value={{ user }}>
      <AgentProvider>{page}</AgentProvider>
    </AuthContext.Provider>
  </MemoryRouter>
)
const savedCalls = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/screener/saved-screens')).length

describe('Agent page hosts are inert for members (review-728-741 #1, #2)', () => {
  it('a member renders a host page exactly as often as without a provider (no registration re-render)', () => {
    localStorage.setItem(AGENT_FLAG_KEY, '1')
    counter.renders = 0
    render(<MemoryRouter><Page /></MemoryRouter>)
    const bare = counter.renders
    cleanup()
    for (const user of [{ id: 'm', role: 'member' }, null]) {
      counter.renders = 0
      render(tree(user, <Page />))
      expect(counter.renders).toBe(bare)
      expect(screen.queryByTestId('agent-launch')).toBeNull()
      cleanup()
    }
    // an admin with the switch OFF is a member here too
    localStorage.removeItem(AGENT_FLAG_KEY)
    counter.renders = 0
    render(tree({ id: 'a', role: 'admin' }, <Page />))
    expect(counter.renders).toBe(bare)
  })

  it('registers once auth resolves to an admin with the switch on (allowed flips true after mount)', async () => {
    localStorage.setItem(AGENT_FLAG_KEY, '1')
    const r = render(tree(null, <Page />))
    expect(screen.queryByTestId('agent-launch')).toBeNull()
    await act(async () => { r.rerender(tree({ id: 'a', role: 'admin' }, <Page />)) })
    expect(screen.getByTestId('agent-launch')).toBeTruthy()
  })

  it('the screener host fetches no saved screens for a member; it does for an allowed admin', async () => {
    localStorage.setItem(AGENT_FLAG_KEY, '1')
    render(tree({ id: 'm', role: 'member' }, <ScreenerPage />))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(savedCalls()).toBe(0)
    cleanup()
    render(tree({ id: 'a', role: 'admin' }, <ScreenerPage />))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(savedCalls()).toBeGreaterThan(0)
  })
})

describe('the page dock has its own error boundary (review-728-741 #3)', () => {
  it('a panel crash stays in the dock: the page keeps rendering', async () => {
    localStorage.setItem(AGENT_FLAG_KEY, '1')
    localStorage.setItem(AGENT_OPEN_KEY, '1')
    render(tree({ id: 'a', role: 'admin' }, <Page />))
    expect(await screen.findByTestId('agent-page-dock-error')).toBeTruthy()
    expect(screen.getByTestId('page')).toBeTruthy()
    expect(screen.getByTestId('agent-page-dock')).toBeTruthy()
  })
})
