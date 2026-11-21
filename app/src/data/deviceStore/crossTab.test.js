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

/** 18:00 ET on the packs' as-of day (seedPackOf's default, 2026-11-18): the seed's own basis holds. */
const AT_ASOF = () => Date.UTC(2026, 10, 18, 23, 0)

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
  const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: async () => new Response(pack) })
  await eng.ingest({ tf: '5', url: 'u', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: 'b1' })
  eng.close()
  return disk
}

function tab(id, env, extra = {}) {
  const posted = []
  const makeIO = vi.fn(async () => memoryIO(env.disk))
  const core = createWorkerCore({
    tabId: id, locks: env.locks, makeChannel: env.bus, makeIO, fetchFn: extra.fetchFn ?? vi.fn(),
    post: (m) => posted.push(m), timeoutMs: 200, liveOpts: extra.liveOpts, engineOpts: { now: AT_ASOF },
  })
  const ask = async (msg) => {
    const id2 = Math.random()
    await core.onMessage({ ...msg, id: id2 })
    return posted.find((m) => m.id === id2)
  }
  return { core, posted, makeIO, ask }
}

describe('device store across tabs', () => {
  it("diagnostics: 'why' reaches the leader's engine from any tab", async () => {
    const env = { disk: await seededDisk(), locks: fakeLocks(), bus: fakeBus() }
    const A = tab('A', env)
    const B = tab('B', env)
    await settle()
    // (synthBars' rows do not end at the as-of session's last bucket: the engine's honest answer, engine._shortOfClose)
    expect((await B.ask({ op: 'why', sym: 'AAA', tf: '5' })).res).toBe('seed-short')
    expect((await B.ask({ op: 'why', sym: 'ZZZ', tf: '5' })).res).toBe('missing')
    expect((await A.ask({ op: 'why', sym: 'AAA', tf: '60' })).res).toBe('no-file')
    A.core.close(); B.core.close()
  })

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
  it('TODAY: a live ask from any tab starts ONE minute feed, in the leader, attached to its engine', async () => {
    const env = { disk: await seededDisk(), locks: fakeLocks(), bus: fakeBus() }
    const made = []
    const load = vi.fn(async () => ({ createMinuteFrameConsumer: (opts) => { const c = { opts, start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({ day: null }) }; made.push(c); return c } }))
    const A = tab('A', env, { liveOpts: { load } })
    const B = tab('B', env, { liveOpts: { load } })
    await settle()
    const r = await B.ask({ op: 'live', visible: true })
    expect(r.ok).toBe(true)
    await A.ask({ op: 'live', visible: true })
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect(made).toHaveLength(1)
    expect(A.core.feed()).not.toBeNull()
    expect(B.core.feed()).toBeNull()
    // the overlay keeps the seed's symbols only: the feed's sink upserts into the leader's engine
    const t = Date.UTC(2026, 10, 18, 15, 0) / 1000                     // 10:00 ET
    made[0].opts.sink.reset({ day: '2026-11-18' })
    made[0].opts.sink.upsert('NOT_IN_SEED', '5', { t, o: 1, h: 1, l: 1, c: 1, v: 1 }, true)
    made[0].opts.sink.upsert('AAA', '5', { t, o: 1, h: 1, l: 1, c: 1, v: 1 }, true)
    const info = await B.ask({ op: 'info' })
    expect(info.res.live.running).toBe(true)
    expect(info.res.live.visible).toBe(true)
    expect(info.res.live.overlay.series).toBe(1)
    A.core.close(); B.core.close()
  })
  it("TODAY: the feed starts only after the seed's ingest in flight, and a new seed re-syncs it", async () => {
    const env = { disk: new Map(), locks: fakeLocks(), bus: fakeBus() }
    const pack = seedPackOf(ROWS, { tf: '5', build: 'b8' })
    const manifest = { v: 1, kind: 'ffseed', build: 'b8', tfs: { '5': { url: '5.pack', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex') } } }
    let releaseManifest
    const fetchFn = vi.fn((url) => (String(url).endsWith('manifest.json')
      ? new Promise((r) => { releaseManifest = () => r(new Response(JSON.stringify(manifest))) })
      : Promise.resolve(new Response(pack))))
    const made = []
    const load = vi.fn(async () => ({ createMinuteFrameConsumer: (opts) => { const c = { opts, start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({}) }; made.push(c); return c } }))
    const A = tab('A', env, { fetchFn, liveOpts: { load } })
    await settle()
    await A.ask({ op: 'ingest', manifestUrl: 'https://x.test/seed/manifest.json' })
    await A.ask({ op: 'live', visible: true })
    await settle()
    expect(load).not.toHaveBeenCalled()                                  // the overlay would not know the symbols yet
    releaseManifest()
    await settle()
    expect(made.length).toBeGreaterThanOrEqual(1)
    expect(A.core.engine().seedName('AAA')).toBe('AAA')
    // a later seed with new data while the feed runs: today is replayed into a clean overlay
    const before = made.length
    const pack2 = seedPackOf({ ...ROWS, ZZZ: ROWS.AAA }, { tf: '5', build: 'b9' })
    const manifest2 = { v: 1, kind: 'ffseed', build: 'b9', tfs: { '5': { url: '5b.pack', bytes: pack2.length, sha256: createHash('sha256').update(pack2).digest('hex') } } }
    fetchFn.mockImplementation((url) => Promise.resolve(String(url).endsWith('manifest.json') ? new Response(JSON.stringify(manifest2)) : new Response(pack2)))
    await A.ask({ op: 'ingest', manifestUrl: 'https://x.test/seed/manifest.json' })
    await A.core.ingesting()
    await settle()
    expect(made.length).toBe(before + 1)
    expect(made[before - 1].stop).toHaveBeenCalled()
    A.core.close()
  })
  it('TODAY: no feed while no seed file is held (a private window, a first visit before the ingest)', async () => {
    const env = { disk: new Map(), locks: fakeLocks(), bus: fakeBus() }
    const load = vi.fn(async () => ({ createMinuteFrameConsumer: () => ({ start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({}) }) }))
    const A = tab('A', env, { liveOpts: { load } })
    await settle()
    const r = await A.ask({ op: 'live', visible: true })
    await settle()
    expect(r.res).toEqual({ status: 'no-seed' })
    expect(load).not.toHaveBeenCalled()
    A.core.close()
  })
})
