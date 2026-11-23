// @vitest-environment node
// THE LEADER'S OWN SERVE FAILING (TERM-033, lib/swallowedFetch.census.test.js). A read the leader's handler throws on
// (an engine that cannot read its file, a handler bug) answers null, so the chart asks the server, as it does when no
// copy is held. That is a MISS, never an error: it is answered null on BOTH paths (this worker's own read, and a
// follower's read over the channel) and COUNTED in `stats()`, which the worker's `info` answer carries.
import { describe, it, expect } from 'vitest'
import { createCrossTab } from './crossTab'
import { createWorkerCore } from './workerCore'
import { memoryIO } from './io'

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

/** Two tabs on one fake BroadcastChannel bus; no Web Locks, so the first tab serves itself (the leader). */
function bus() {
  const members = new Set()
  return (/* name */) => {
    const ch = {
      onmessage: null,
      postMessage(data) {
        for (const m of members) if (m !== ch) queueMicrotask(() => m.onmessage?.({ data: structuredClone(data) }))
      },
      close() { members.delete(ch) },
    }
    members.add(ch)
    return ch
  }
}

describe("the leader's serve failing is a counted miss", () => {
  it("this worker's own read: null, counted, with the cause", async () => {
    const xt = createCrossTab({ locks: null, makeChannel: null, tabId: 'A', serve: () => { throw new Error('engine gone') } })
    expect(await xt.request({ op: 'read', sym: 'AAPL', tf: 'D' })).toBeNull()
    expect(xt.stats()).toEqual({ serveFailures: 1, lastServeError: 'engine gone' })
    xt.close()
  })

  it('a failure that cannot be turned into text is still a counted miss, never a rejection', async () => {
    // (review of #2611) String(Object.create(null)) throws: noting the failure must not itself fail the read
    const xt = createCrossTab({ locks: null, makeChannel: null, tabId: 'A', serve: () => { throw Object.create(null) } })
    await expect(xt.request({ op: 'read', sym: 'AAPL', tf: 'D' })).resolves.toBeNull()
    expect(xt.stats().serveFailures).toBe(1)
    expect(typeof xt.stats().lastServeError).toBe('string')
    xt.close()
  })

  it('CONTROL: a serve that answers is passed through and counts nothing', async () => {
    const xt = createCrossTab({ locks: null, makeChannel: null, tabId: 'A', serve: (req) => ({ ok: req.sym }) })
    expect(await xt.request({ op: 'read', sym: 'AAPL', tf: 'D' })).toEqual({ ok: 'AAPL' })
    expect(xt.stats()).toEqual({ serveFailures: 0, lastServeError: null })
    xt.close()
  })

  it("a follower's read over the channel: the follower gets null at once (not at its timeout), the leader counts it", async () => {
    const make = bus()
    // the follower's lock is held elsewhere: `ifAvailable` answers null, the queued request is never granted
    const heldElsewhere = { request: (_n, opts, cb) => (typeof opts === 'function' ? new Promise(() => {}) : cb(null)) }
    const leader = createCrossTab({ locks: null, makeChannel: make, tabId: 'L', serve: async () => { throw new Error('read failed') } })
    const follower = createCrossTab({ locks: heldElsewhere, makeChannel: make, tabId: 'F', serve: () => 'never', timeoutMs: 5000 })
    await flush()
    expect([leader.isLeader(), follower.isLeader()]).toEqual([true, false])
    const t0 = Date.now()
    expect(await follower.request({ op: 'read', sym: 'AAPL', tf: 'D' })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(leader.stats()).toEqual({ serveFailures: 1, lastServeError: 'read failed' })
    expect(follower.stats().serveFailures).toBe(0)
    leader.close(); follower.close()
  })

  it("the worker's info answer carries the count (zero on a healthy leader)", async () => {
    const posted = []
    const core = createWorkerCore({
      post: (m) => posted.push(m), locks: null, makeChannel: null, makeIO: async () => memoryIO(new Map()),
      fetchFn: async () => { throw new Error('no network here') }, tabId: 'A',
    })
    await flush()
    await core.onMessage({ id: 1, op: 'info' })
    const res = posted.find((m) => m.id === 1)?.res
    expect(res?.crossTab).toEqual({ serveFailures: 0, lastServeError: null })
    core.close()
  })
})
