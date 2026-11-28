// UCT Agent: the MEMBER DOOR in the browser (UCT_AGENT_MEMBERS_ENABLED; decided 2026-11-24 by the integrator under the
// owner's delegation of 2026-11-24). The server's answer arrives in the auth payload (`uct_agent_members_enabled`, read
// from AuthContext `featureStatus`, agentFlag.authDoor); the config's `members` never opens it. Door closed:
// exactly as before (an admin with the per-browser switch, nobody else, and NO request from a member's browser). Door
// open: a PAID member sees the Agent by default; the switch '0' hides it; an admin's default turns on too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { AGENT_FLAG_KEY, AGENT_OPEN_EVENT, AGENT_CONVERSATION_KEY, agentAccess, agentDoorOpen, resolveAgentFlag, _resetAgentDoor } from './agentFlag'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { canUseAgent, openAgent } from './newsAsk'
import AgentProvider, { AgentDockButton } from './AgentProvider'
import { useAgentPageHost } from './agentApp'

vi.mock('./AgentPanel', () => ({ default: () => null }))

const FS_ON = { measured: true, features: [{ id: 'uct_agent_members_enabled', label: 'UCT Agent', where: 'Charts', state: 'released' }] }
const FS_OFF = { measured: true, features: [] }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  _resetAgentConfig()
  _resetAgentDoor()
  globalThis.fetch = vi.fn(async () => json({}))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const HOST = { surface: 'breadth', location: () => '/breadth' }
function Page() {
  useAgentPageHost('breadth', HOST)
  return <div data-testid="page"><AgentDockButton /></div>
}
const MEMBER = { id: 'm1', role: 'member' }
const ADMIN = { id: 'a1', role: 'admin' }
function mount({ user = MEMBER, isPaid = true, members = false, flag = null } = {}) {
  if (flag != null) localStorage.setItem(AGENT_FLAG_KEY, flag)
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user, isPaid, featureStatus: members ? FS_ON : FS_OFF }}>
        <AgentProvider><Page /></AgentProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}
const launch = () => screen.queryByTestId('agent-launch')

describe('agentAccess (pure): who may see UCT Agent', () => {
  it.each([
    // [who, isPaid, door, stored, expected]
    ['member', true, false, null, false], ['member', true, false, '1', false],        // door closed: no member, ever
    ['member', true, true, null, true], ['member', true, true, '1', true],            // door open: a paid member, by default
    ['member', true, true, '0', false],                                               // ... unless switched off here
    ['member', false, true, null, false], ['member', false, true, '1', false],        // never an unpaid account
    ['admin', true, false, null, false], ['admin', true, false, '1', true],           // admin, door closed: exactly as before
    ['admin', true, false, '0', false],
    ['admin', true, true, null, true], ['admin', true, true, '0', false],             // admin, door open: default on
    [null, true, true, '1', false],                                                   // signed out
  ])('%s paid=%s door=%s switch=%s -> %s', (who, isPaid, door, stored, expected) => {
    const user = who ? { id: 'x', role: who } : null
    expect(agentAccess({ user, isPaid, door, stored })).toBe(expected)
  })
})

describe('the provider: door CLOSED is exactly as before', () => {
  it('a paid member sees nothing and the browser asks the server nothing (even with the switch forced on)', async () => {
    mount({ flag: '1' })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(launch()).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('an admin sees it only with the switch on, as before', () => {
    mount({ user: ADMIN })
    expect(launch()).toBeNull()
    cleanup()
    mount({ user: ADMIN, flag: '1' })
    expect(launch()).toBeTruthy()
  })
})

describe('the provider: door OPEN (uct_agent_members_enabled true)', () => {
  it('a paid member sees the Agent by default (the per-browser switch is on by default for them)', () => {
    mount({ members: true })
    expect(launch()).toBeTruthy()
    expect(agentDoorOpen()).toBe(true)
    expect(resolveAgentFlag()).toBe(true)
  })

  it('a member who switched it off in this browser sees nothing; an unpaid account sees nothing', () => {
    mount({ members: true, flag: '0' })
    expect(launch()).toBeNull()
    cleanup()
    mount({ members: true, isPaid: false })
    expect(launch()).toBeNull()
  })

  it("an admin's default turns on with the door", () => {
    mount({ user: ADMIN, members: true })
    expect(launch()).toBeTruthy()
  })

  it('the emergency off: the next auth payload without the listing closes the door in an open tab', () => {
    const tree = (members) => (
      <MemoryRouter>
        <AuthContext.Provider value={{ user: MEMBER, isPaid: true, featureStatus: members ? FS_ON : FS_OFF }}>
          <AgentProvider><Page /></AgentProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    )
    const { rerender } = render(tree(true))
    expect(launch()).toBeTruthy()
    rerender(tree(false))
    expect(launch()).toBeNull()
    expect(agentDoorOpen()).toBe(false)
  })

  it("a listing the server could not vouch for ('unknown') does not open it; the config's `members` never does", async () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ user: MEMBER, isPaid: true, featureStatus: { measured: true, features: [{ ...FS_ON.features[0], state: 'unknown' }] } }}>
          <AgentProvider><Page /></AgentProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )
    expect(launch()).toBeNull()
    globalThis.fetch = vi.fn(async () => json({ stream: false, members: true }))
    await act(async () => { await loadAgentConfig() })
    expect(launch()).toBeNull()
  })
})

describe('News: canUseAgent and openAgent follow the same door', () => {
  it('canUseAgent: a paid member only while the door is open', () => {
    expect(canUseAgent(MEMBER, true)).toBe(false)
    mount({ members: true })
    expect(canUseAgent(MEMBER, true)).toBe(true)
    expect(canUseAgent(MEMBER, false)).toBe(false)
    expect(canUseAgent(MEMBER)).toBe(false)
  })

  it('openAgent works for a member once the door is open (default switch), and not before', () => {
    window.history.pushState({}, '', '/charts')
    const seen = vi.fn()
    window.addEventListener(AGENT_OPEN_EVENT, seen)
    openAgent({ conversationId: 'ac_door_1' })
    expect(seen).not.toHaveBeenCalled()
    mount({ members: true })
    openAgent({ conversationId: 'ac_door_1' })
    window.removeEventListener(AGENT_OPEN_EVENT, seen)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(AGENT_CONVERSATION_KEY)).toBe('ac_door_1')
  })
})
