// @vitest-environment node
// ONE owner across tabs: several "tabs" (worker cores) share one disk, one Web Lock manager and one
// BroadcastChannel bus (fakes with the real semantics: a lock is granted to one requester at a time,
// in order, and released when its callback's promise settles; a channel message reaches every OTHER
// member as a structured clone). Only the leader opens files; followers read through it; when the
// leader goes, the next tab takes over.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createWorkerCore } from './workerCore'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

function fakeLocks() {
  const queues = new Map()
  const held = new Set()
  function next(name) {
    const q = queues.get(name)
    if (!q?.length || held.has(name)) return
    const { cb, resolve, reject } = q.shift()
    held.add(name)
    Promise.resolve().then(() => cb({ name })).then(
      (v) => { held.delete(name); resolve(v); next(name) },
      (e) => { held.delete(name); reject(e); next(name) },
    )
  }
  return {
    // (name, cb) or (name, {ifAvailable}, cb): ifAvailable answers AT ONCE, with null when the lock is
    // held or anyone is queued for it (the Web Locks rule)
    request(name, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {} }
      return new Promise((resolve, reject) => {
        if (!queues.has(name)) queues.set(name, [])
        if (opts.ifAvailable && (held.has(name) || queues.get(name).length)) {
          Promise.resolve().then(() => cb(null)).then(resolve, reject)
          return
        }
        queues.get(name).push({ cb, resolve, reject })
        next(name)
      })
    },
  }
}
function fakeBus() {
  const members = new Set()
  const log = []                        // every message, with the index of the channel that sent it
  let n = 0
  const make = (/* name */) => {
    const ch = {
      id: n++,
      onmessage: null,
      postMessage(data) {
        const copy = structuredClone(data)
        log.push({ from: ch.id, data: copy })
        for (const m of members) if (m !== ch) queueMicrotask(() => m.onmessage?.({ data: structuredClone(copy) }))
      },
      close() { members.delete(ch) },
    }
    members.add(ch)
    return ch
  }
  make.log = log
  return make
}
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

const ROWS = { AAA: synthBars(1000, { step: 300, seed: 3 }), BBB: synthBars(600, { step: 300, seed: 4 }) }
async function seededDisk() {
  const pack = seedPackOf(ROWS, { tf: '5', build: 'b1' })
  const disk = new Map()
  const eng = createDeviceEngine({ io: memoryIO(disk), fetchFn: async () => new Response(pack) })
  await eng.ingest({ tf: '5', url: 'u', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: 'b1' })
  eng.close()
  return disk
}

function tab(id, env, extra = {}) {
  const posted = []
  const makeIO = vi.fn(async () => memoryIO(env.disk))
  const core = createWorkerCore({
    tabId: id, locks: env.locks, makeChannel: env.bus, makeIO, fetchFn: extra.fetchFn ?? vi.fn(),
    post: (m) => posted.push(m), timeoutMs: 200,
  })
  const ask = async (msg) => {
    const id2 = Math.random()
    await core.onMessage({ ...msg, id: id2 })
    return posted.find((m) => m.id === id2)
  }
  return { core, posted, makeIO, ask }
}

describe('device store across tabs', () => {
  it('ONE leader opens the files; a follower reads EXACT columns through it and never opens a file', async () => {
    const env = { disk: await seededDisk(), locks: fakeLocks(), bus: fakeBus() }
    const A = tab('A', env)
    const B = tab('B', env)
    const C = tab('C', env)              // another follower on the bus: it must stay silent
    await settle()
    expect(A.core.isLeader()).toBe(true)
    expect(B.core.isLeader()).toBe(false)
    expect(A.makeIO).toHaveBeenCalledTimes(1)
    expect(B.makeIO).not.toHaveBeenCalled()
    expect(C.makeIO).not.toHaveBeenCalled()
    const r = await B.ask({ op: 'read', sym: 'AAA', tf: '5' })
    await settle(3)
    // only the leader (A's channel, the first made) ever answers a request
    const answers = env.bus.log.filter((m) => m.data.type === 'res')
    expect(answers.map((m) => m.from)).toEqual([0])
    expect(r.ok).toBe(true)
    expect(r.res.build).toBe('b1')
    expect(Array.from(r.res.c)).toEqual(ROWS.AAA.map((x) => x.c))
    expect(Array.from(r.res.t)).toEqual(ROWS.AAA.map((x) => x.t))
    // the leader's own page reads locally
    const a = await A.ask({ op: 'readMany', syms: ['BBB', 'ZZZ'], tf: '5' })
    expect(a.res[0].v.length).toBe(600)
    expect(a.res[1]).toBeNull()
    expect(A.posted.find((m) => m.type === 'status')).toMatchObject({ role: 'leader', supported: true })
    A.core.close(); B.core.close(); C.core.close()
  })

  it('a lone tab\'s FIRST requests (sent before its lock is granted) are served as the leader, not lost', async () => {
    // measured in Chromium: the page's ingest kick and first read leave the moment the worker starts
    const env = { disk: await seededDisk(), locks: fakeLocks(), bus: fakeBus() }
    const A = tab('A', env)
    const r = await A.ask({ op: 'read', sym: 'AAA', tf: '5' })       // no settle(): the lock is not granted yet
    expect(r.res?.t.length).toBe(1000)
    expect(env.bus.log.filter((m) => m.data.type === 'req')).toHaveLength(0)   // never sent to "a leader" elsewhere
    // ...and a second tab knows AT ONCE it is a follower (its read goes to A, answered)
    const B = tab('B', env)
    const b = await B.ask({ op: 'read', sym: 'BBB', tf: '5' })
    expect(b.res?.t.length).toBe(600)
    A.core.close(); B.core.close()
  })

  it('when the leader goes, the next tab becomes the leader, opens the files and serves', async () => {
    const env = { disk: await seededDisk(), locks: fakeLocks(), bus: fakeBus() }
    const A = tab('A', env)
    const B = tab('B', env)
    const C = tab('C', env)
    await settle()
    expect([A, B, C].map((t) => t.core.isLeader())).toEqual([true, false, false])
    A.core.close()                       // the tab closed: its lock and its file handles go with it
    await settle()
    expect([B, C].map((t) => t.core.isLeader())).toEqual([true, false])
    expect(B.makeIO).toHaveBeenCalledTimes(1)
    const r = await C.ask({ op: 'read', sym: 'BBB', tf: '5' })
    expect(Array.from(r.res.o)).toEqual(ROWS.BBB.map((x) => x.o))
    B.core.close(); C.core.close()
  })

  it('a follower whose leader does not answer reads null after the timeout (the chart then asks the server)', async () => {
    const env = { disk: await seededDisk(), locks: fakeLocks(), bus: fakeBus() }
    const A = tab('A', env)
    await settle()
    // D waits for the lock A holds (a follower), but nothing it posts reaches A (a frozen leader page)
    const silent = { disk: env.disk, locks: env.locks, bus: () => ({ postMessage() {}, close() {}, onmessage: null }) }
    const D = tab('D', silent)
    await settle()
    expect([A.core.isLeader(), D.core.isLeader()]).toEqual([true, false])
    const t0 = Date.now()
    const r = await D.ask({ op: 'read', sym: 'AAA', tf: '5' })
    expect(r).toMatchObject({ ok: true, res: null })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150)
    expect(D.makeIO).not.toHaveBeenCalled()
    A.core.close(); D.core.close()
  })

  it('an ingest asked from ANY tab runs once, in the leader', async () => {
    const env = { disk: new Map(), locks: fakeLocks(), bus: fakeBus() }
    const pack = seedPackOf(ROWS, { tf: '5', build: 'b7' })
    const manifest = { v: 1, kind: 'ffseed', build: 'b7', tfs: { '5': { url: '5.pack', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex') } } }
    const leaderFetch = vi.fn(async (url) => (String(url).endsWith('manifest.json') ? new Response(JSON.stringify(manifest)) : new Response(pack)))
    const followerFetch = vi.fn()
    const A = tab('A', env, { fetchFn: leaderFetch })
    const B = tab('B', env, { fetchFn: followerFetch })
    await settle()
    const r = await B.ask({ op: 'ingest', manifestUrl: 'https://x.test/seed/manifest.json' })
    expect(r.res).toEqual({ status: 'started' })
    await A.core.ingesting()
    await settle()
    expect(followerFetch).not.toHaveBeenCalled()
    expect(leaderFetch.mock.calls.map((c) => String(c[0]))).toEqual(['https://x.test/seed/manifest.json', 'https://x.test/seed/5.pack'])
    // every tab's page hears that a new generation landed (its sync cache drops that timeframe)
    expect(A.posted.some((m) => m.type === 'event' && m.event.type === 'gen' && m.event.tf === '5')).toBe(true)
    expect(B.posted.some((m) => m.type === 'event' && m.event.type === 'gen' && m.event.build === 'b7')).toBe(true)
    const got = await B.ask({ op: 'read', sym: 'AAA', tf: '5' })
    expect(got.res.t.length).toBe(1000)
    A.core.close(); B.core.close()
  })
})
