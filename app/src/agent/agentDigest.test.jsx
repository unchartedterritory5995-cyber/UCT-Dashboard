// settings.setWatchlistDigest — the existing digest route; opting INTO email is always a
// proposal; every write read back; no Undo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, refreshContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan } from './runtime'
import { _resetDigestCache, loadDigest } from './capabilities/digest'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
let server, calls, refuse
beforeEach(() => {
  _resetDigestCache(); server = 'off'; calls = []; refuse = false
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const m = init.method || 'GET'; calls.push([m, u, init.body ? JSON.parse(init.body) : null])
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    if (u === '/api/watchlists/digest-settings') {
      if (m === 'PUT') {
        if (refuse) return json({ detail: 'database is locked' }, 500)
        const f = JSON.parse(init.body).frequency
        if (!['off', 'daily', 'weekly'].includes(f)) return json({ detail: "frequency must be 'off', 'daily', or 'weekly'" }, 400)
        server = f; return json({ frequency: f })
      }
      return json({ frequency: server })
    }
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks() })

const op = (frequency) => [{ action: 'settings.setWatchlistDigest', target: 'digest', args: { frequency } }]
async function plan(host, ops) {
  await loadDigest()
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, ['digest']), ops, env, { surface: 'charts' }), env }
}
const puts = () => calls.filter(c => c[0] === 'PUT')

describe('watchlist digest', () => {
  it('turning it ON is always a PROPOSAL that says recurring email; Apply writes the canonical route and reads it back; no Undo', async () => {
    const { host } = makeBoard([])
    const { p, env } = await plan(host, op('daily'))
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/ON, daily — UCT will email a performance summary of your watchlists to your account email every day at 5 PM ET until you turn it off/)
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(res.undo).toBeNull()
    expect(puts().map(c => c[2])).toEqual([{ frequency: 'daily' }])
    expect(server).toBe('daily')
    expect(calls.filter(c => c[0] === 'GET').length).toBeGreaterThanOrEqual(3)   // load + re-read before + read back
  })
  it('turning it OFF applies directly (fewer emails) — still no Undo (an Undo would re-enrol)', async () => {
    server = 'weekly'
    const { host } = makeBoard([])
    const { p, env } = await plan(host, op('off'))
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(host, p, { env })
    expect(res.ok && res.undo === null).toBe(true)
    expect(server).toBe('off')
  })
  it('changed in Settings since the proposal → refused at Apply, nothing written', async () => {
    const { host } = makeBoard([])
    const { p, env } = await plan(host, op('weekly'))
    server = 'daily'
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/changed since I read it \(it is daily/)
    expect(puts()).toHaveLength(0)
  })
  it('a server refusal is reported, never a receipt; an unknown frequency never reaches the server; unread → no change', async () => {
    const { host } = makeBoard([])
    const a = await plan(host, op('daily'))
    refuse = true
    const res = await commitPlan(host, a.p, { env: a.env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/database is locked/)
    expect((await plan(host, op('hourly'))).p.ok).toBe(false)
    _resetDigestCache()
    const env = await prepareOps(op('daily'))
    expect(planOps(collectTargets(host, ['digest']), op('daily'), env, { surface: 'charts' }).refusals[0].reason).toMatch(/couldn't read your current digest setting/)
  })
  it('the model sees the current setting (re-read before each turn)', async () => {
    server = 'weekly'
    const { host } = makeBoard([])
    await refreshContext()
    expect(buildContext(host, { surface: 'charts' }).context.watchlistDigest[0].setting).toBe('weekly (every Friday at 5 PM ET)')
  })
})
