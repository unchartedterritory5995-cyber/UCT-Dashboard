// @vitest-environment node
// The page's client over a real worker core (in-process, structured-clone messages): exact reads, the
// SYNCHRONOUS recently-read cache, one message per key in flight, a new generation dropping what it
// replaced, the ingest asked once after the first chart paint, and a worker that cannot start.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createDeviceClient } from './client'
import { createWorkerCore } from './workerCore'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

/** 18:00 ET on the packs' as-of day (seedPackOf's default, 2026-11-18): the seed's own basis holds. */
const AT_ASOF = () => Date.UTC(2026, 10, 18, 23, 0)

const DAY = 86400
const D0 = Date.UTC(2025, 0, 6) / 1000
const daily = (n, seed) => synthBars(n, { seed }).map((r, i) => ({ ...r, t: D0 + i * DAY }))
const ROWS = { AAA: daily(350, 1), BBB: daily(350, 2), CCC: daily(350, 3) }

async function disk() {
  const pack = seedPackOf(ROWS, { build: '20261119T2200Z' })
  const d = new Map()
  const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(d), fetchFn: async () => new Response(pack) })
  await eng.ingest({ tf: 'D', url: 'u', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: '20261119T2200Z' })
  eng.close()
  return d
}

function workerOver(d) {
  const w = { onmessage: null, onerror: null, posted: [], terminate: vi.fn() }
  const core = createWorkerCore({
    tabId: 'T', locks: null, makeChannel: null, makeIO: async () => memoryIO(d), fetchFn: vi.fn(), engineOpts: { now: AT_ASOF },
    post: (m) => queueMicrotask(() => w.onmessage?.({ data: m })),
  })
  w.postMessage = (m) => { w.posted.push(m); core.onMessage(structuredClone(m)) }
  w.core = core
  return w
}

describe('device client', () => {
  it('getBars → exact columns; then peekBars answers SYNCHRONOUSLY with the same object; one message per key in flight', async () => {
    const w = workerOver(await disk())
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {} })
    expect(c.peekBars('AAA', 'D')).toBeNull()
    const [a, b] = await Promise.all([c.getBars('AAA', 'D'), c.getBars('aaa', 'D')])
    expect(a).toBe(b)
    expect(w.posted.filter((m) => m.op === 'read')).toHaveLength(1)
    expect(Array.from(a.c)).toEqual(ROWS.AAA.map((r) => r.c))
    expect(a.build).toBe('20261119T2200Z')
    expect(c.peekBars('AAA', 'D')).toBe(a)
    expect(await c.getBars('AAA', 'D')).toBe(a)               // a cache hit costs no message
    expect(w.posted.filter((m) => m.op === 'read')).toHaveLength(1)
    expect(await c.getBars('NOPE', 'D')).toBeNull()
    expect(await c.getBars('AAA', '60e')).toBeNull()          // not a seeded key: no message at all
    expect(w.posted.filter((m) => m.tf === '60e')).toHaveLength(0)
  })

  it('warm reads many in ONE message; the cache is an LRU of cacheMax keys', async () => {
    const w = workerOver(await disk())
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, cacheMax: 2 })
    expect(await c.warm(['AAA', 'BBB', 'ZZZ'], 'D')).toBe(2)
    expect(w.posted.filter((m) => m.op === 'readMany')).toHaveLength(1)
    expect(c.peekBars('BBB', 'D').v.length).toBe(350)
    expect(c.peekBars('AAA', 'D')).not.toBeNull()            // touched: now the newest
    await c.getBars('CCC', 'D')                               // evicts the least recent (BBB)
    expect(c.cacheSize()).toBe(2)
    expect(c.peekBars('BBB', 'D')).toBeNull()
    expect(c.peekBars('AAA', 'D')).not.toBeNull()
  })

  it('a new D generation drops the cached D, W and M (and nothing else)', async () => {
    const w = workerOver(await disk())
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {} })
    await c.getBars('AAA', 'D'); await c.getBars('AAA', 'W'); await c.getBars('AAA', 'M')
    expect(c.peekBars('AAA', 'W').t.length).toBe(49)          // 350 calendar days = 50 ISO weeks, the oldest dropped
    w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: '5', build: 'x' } } })
    expect(c.cacheSize()).toBe(3)
    w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: 'D', build: 'x' } } })
    expect(c.cacheSize()).toBe(0)
  })

  it('start(): the ingest is asked ONCE, only after the first chart paint and idle', async () => {
    const w = workerOver(await disk())
    const painted = []
    const idle = vi.fn((fn) => fn())
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: (fn) => { painted.push(fn) }, idle, manifestUrl: () => 'https://x.test/m.json' })
    c.start(); c.start()
    expect(w.posted.filter((m) => m.op === 'ingest')).toHaveLength(0)
    painted.forEach((fn) => fn())                            // the first chart paint fires every waiter
    expect(idle).toHaveBeenCalledTimes(1)
    expect(w.posted.filter((m) => m.op === 'ingest')).toEqual([expect.objectContaining({ manifestUrl: 'https://x.test/m.json' })])
  })

  it('a worker that cannot start (or dies) reads null, never throws', async () => {
    const c = createDeviceClient({ makeWorker: () => { throw new Error('CSP') }, afterPaint: () => {} })
    expect(await c.getBars('AAA', 'D')).toBeNull()
    const w = workerOver(await disk())
    w.postMessage = () => {}                                   // a read that never answers ...
    const c2 = createDeviceClient({ makeWorker: () => w, afterPaint: () => {} })
    const p = c2.getBars('AAA', 'D')
    w.onerror()                                                // ... until the worker errors
    expect(await p).toBeNull()
  })
  it('the synchronous cache expires (today moves every minute): past the TTL the worker is asked again', async () => {
    const w = workerOver(await disk())
    let t = 1_000_000
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, now: () => t, cacheTtlMs: 60_000 })
    await c.getBars('AAA', 'D')
    t += 59_000
    expect(c.peekBars('AAA', 'D')).not.toBeNull()
    t += 2_000
    expect(c.peekBars('AAA', 'D')).toBeNull()
    await c.getBars('AAA', 'D')
    expect(w.posted.filter((m) => m.op === 'read')).toHaveLength(2)
  })

  it("after the first chart paint the leader is asked to follow today, and hears this page's visibility", async () => {
    const w = workerOver(await disk())
    let vis = true
    let onChange = null
    const ticks = []
    const c = createDeviceClient({
      makeWorker: () => w, afterPaint: (fn) => fn(), idle: (fn) => fn(), manifestUrl: () => 'https://x.test/m.json',
      visible: () => vis, onVisibilityChange: (cb) => { onChange = cb }, setIntervalFn: (fn) => { ticks.push(fn) },
    })
    c.start()
    const live = () => w.posted.filter((m) => m.op === 'live').map((m) => m.visible)
    expect(live()).toEqual([true])
    vis = false; onChange()
    expect(live()).toEqual([true, false])
    ticks.forEach((fn) => fn())                                           // hidden: the heartbeat says nothing
    expect(live()).toEqual([true, false])
    vis = true; ticks.forEach((fn) => fn())
    expect(live()).toEqual([true, false, true])
  })
  it('persistent storage is asked ONCE, only once a seed file is held, and the answer is in status()', async () => {
    const w = workerOver(await disk())
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) }
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, storage })
    c.start()
    w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: {} } } })   // no seed yet
    await Promise.resolve(); await Promise.resolve()
    expect(storage.persisted).not.toHaveBeenCalled()
    w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
    w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: '5', build: 'b' } } })
    await new Promise((r) => setTimeout(r, 0))
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(c.status().storage).toEqual({ asked: true, persisted: true, granted: true, error: null })
    const already = { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) }
    const c2 = createDeviceClient({ makeWorker: () => workerOver(new Map()), afterPaint: () => {}, storage: already })
    c2.start()
    c2.dispose()
    const w2 = workerOver(await disk())
    const c3 = createDeviceClient({ makeWorker: () => w2, afterPaint: () => {}, storage: already })
    c3.start()
    w2.onmessage({ data: { type: 'event', event: { type: 'gen', tf: 'D', build: 'b' } } })
    await new Promise((r) => setTimeout(r, 0))
    expect(already.persist).not.toHaveBeenCalled()                        // already persistent: nothing asked
    expect(c3.status().storage.persisted).toBe(true)
  })
})
