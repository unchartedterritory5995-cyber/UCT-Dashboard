// PROGRAM Sprint 0 — the browser side of MD-1 is dark: while the server's config does not say data: true, readData
// answers `refused` locally and makes NO request; once it does, it posts one read and returns the envelope as sent.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readData } from './marketdata/client'
import { loadAgentConfig, _resetAgentConfig, serverServesData, serverServesScan } from './agentClient'

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })

describe('MD-1 browser client (dark by default)', () => {
  beforeEach(() => { _resetAgentConfig(); vi.restoreAllMocks() })

  it('makes no request while the server does not serve the gateway (the default)', async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).endsWith('/config') ? json({ stream: false, nl1: false, data: false, scan: false }) : json({})))
    await loadAgentConfig()
    expect(serverServesData()).toBe(false)
    expect(serverServesScan()).toBe(false)
    const out = await readData('quote', { symbol: 'SPY' }, { turnId: 't1' })
    expect(out).toMatchObject({ contract: 'MD-1.0', status: 'refused', freshness: 'unavailable', data: null, as_of: null })
    expect(globalThis.fetch.mock.calls.map(c => c[0])).toEqual(['/api/agent/config'])
  })

  it('an older server (no data key) counts as off', async () => {
    globalThis.fetch = vi.fn(async () => json({ stream: false, nl1: false }))
    await loadAgentConfig()
    expect(serverServesData()).toBe(false)
  })

  it('when served: one POST /api/agent/data with the turn id, the envelope returned as sent', async () => {
    const envelope = { contract: 'MD-1.0', kind: 'quote', status: 'ok', freshness: 'live', as_of: '2026-11-01T15:59:00Z', data: { last: 1 } }
    globalThis.fetch = vi.fn(async (url) => (String(url).endsWith('/config') ? json({ data: true, scan: false }) : json(envelope)))
    await loadAgentConfig()
    const out = await readData('quote', { symbol: 'SPY' }, { turnId: 't1' })
    expect(out).toEqual(envelope)
    const post = globalThis.fetch.mock.calls.find(c => c[0] === '/api/agent/data')
    expect(JSON.parse(post[1].body)).toEqual({ kind: 'quote', params: { symbol: 'SPY' }, purpose: 'answer', turn_id: 't1' })
    // no turn id → refused locally
    expect((await readData('quote', {}, {})).status).toBe('refused')
  })
})
