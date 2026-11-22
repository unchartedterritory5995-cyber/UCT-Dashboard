// W2-C1 — the app-level Agent host: dark unless admin + switch; a page that registers a host gets the dock
// button and the panel on ITS surface; /charts keeps its own mount (`owned`) and the provider renders nothing there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { AGENT_FLAG_KEY, AGENT_OPEN_KEY } from './agentFlag'
import AgentProvider, { AgentDockButton } from './AgentProvider'
import { useAgentPageHost } from './agentApp'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const HOST = { surface: 'breadth', location: () => '/breadth', breadthPage: { snapshot: () => ({ tab: 'breadth', days: 90, topDate: '2026-11-02', rowCount: 3, columns: [], live: false }) } }
function Page({ surface = 'breadth', host = HOST, owned = false }) {
  useAgentPageHost(surface, host, { owned })
  return <div data-testid="page"><AgentDockButton /></div>
}
function mount({ role = 'admin', flag = '1', page = <Page /> } = {}) {
  if (flag != null) localStorage.setItem(AGENT_FLAG_KEY, flag)
  else localStorage.removeItem(AGENT_FLAG_KEY)
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'u1', role, display_name: 'Blake' } }}>
        <AgentProvider>{page}</AgentProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('AgentProvider (W2-C1)', () => {
  it('DARK: a member (or an admin with the switch off) sees no button and no dock', () => {
    mount({ role: 'member' })
    expect(screen.queryByTestId('agent-launch')).toBeNull()
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
    cleanup()
    mount({ role: 'admin', flag: null })
    expect(screen.queryByTestId('agent-launch')).toBeNull()
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
  })

  it('a page with a host: the button opens the panel on THAT surface; closing it writes the shared open key', { timeout: 20000 }, async () => {
    mount()
    const btn = screen.getByTestId('agent-launch')
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
    fireEvent.click(btn)
    const dock = await screen.findByTestId('agent-page-dock')
    expect(dock.getAttribute('data-surface')).toBe('breadth')
    expect(await screen.findByTestId('agent-panel', {}, { timeout: 15000 })).toBeTruthy()
    expect(localStorage.getItem(AGENT_OPEN_KEY)).toBe('1')
    fireEvent.click(screen.getByLabelText('Close UCT Agent'))
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
    expect(localStorage.getItem(AGENT_OPEN_KEY)).toBe('0')
  })

  it('/charts owns its own mount: no provider dock and no second button there', () => {
    localStorage.setItem(AGENT_OPEN_KEY, '1')
    mount({ page: <Page surface="charts" host={{ charts: { list: () => [] } }} owned /> })
    expect(screen.queryByTestId('agent-launch')).toBeNull()
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
  })

  it('the open state follows the page: opened on one page (the key), the next page with a host shows it open', async () => {
    localStorage.setItem(AGENT_OPEN_KEY, '1')         // what /charts wrote when the member opened it there
    mount()
    expect(await screen.findByTestId('agent-page-dock')).toBeTruthy()
  })

  it('a page without a host: nothing renders, even for an admin with the switch on', () => {
    mount({ page: <div data-testid="plain"><AgentDockButton /></div> })
    expect(screen.getByTestId('plain')).toBeTruthy()
    expect(screen.queryByTestId('agent-launch')).toBeNull()
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
  })

  it('leaving the page unregisters its host: the dock goes with it', async () => {
    localStorage.setItem(AGENT_OPEN_KEY, '1')
    const r = mount()
    expect(await screen.findByTestId('agent-page-dock')).toBeTruthy()
    await act(async () => {
      r.rerender(
        <MemoryRouter>
          <AuthContext.Provider value={{ user: { id: 'u1', role: 'admin' } }}>
            <AgentProvider><div data-testid="other" /></AgentProvider>
          </AuthContext.Provider>
        </MemoryRouter>,
      )
    })
    expect(screen.queryByTestId('agent-page-dock')).toBeNull()
  })
})
