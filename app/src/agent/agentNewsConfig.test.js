// News -> Agent: serverNewsState() reads the Agent's ONE cached /api/agent/config answer — null until it has
// answered, then whether this server serves headline chats (UCT_AGENT_NEWS); false on any refusal or error.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadAgentConfig, serverNewsState, _resetAgentConfig } from './agentClient'

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => { _resetAgentConfig() })

describe('serverNewsState', () => {
  it('null before the config has answered, true when it reports news on', async () => {
    globalThis.fetch = vi.fn(async () => json({ stream: false, nl1: false, news: true, data: false, scan: false, data_kinds: [] }))
    expect(serverNewsState()).toBe(null)
    await loadAgentConfig()
    expect(serverNewsState()).toBe(true)
    await loadAgentConfig()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)          // cached: one read, however many headlines ask
  })

  it.each([
    ['news off', () => json({ stream: false, news: false })],
    ['an older server with no news key', () => json({ stream: false })],
    ['a member (403)', () => json({ detail: 'Admin only' }, 403)],
  ])('false for %s', async (_, reply) => {
    globalThis.fetch = vi.fn(async () => reply())
    await loadAgentConfig()
    expect(serverNewsState()).toBe(false)
  })

  it('false when the config cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    await loadAgentConfig()
    expect(serverNewsState()).toBe(false)
  })
})
