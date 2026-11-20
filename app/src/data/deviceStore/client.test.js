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
import { packOf, synthBars } from './testing/fixtures'

const DAY = 86400
const D0 = Date.UTC(2025, 0, 6) / 1000
const daily = (n, seed) => synthBars(n, { seed }).map((r, i) => ({ ...r, t: D0 + i * DAY }))
const ROWS = { AAA: daily(350, 1), BBB: daily(350, 2), CCC: daily(350, 3) }

async function disk() {
  const pack = packOf(ROWS)
  const d = new Map()
  const eng = createDeviceEngine({ io: memoryIO(d), fetchFn: async () => new Response(pack) })
  await eng.ingest({ tf: 'D', url: 'u', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: '2026-11-19T22:00:00Z' })
  eng.close()
  return d
}

function workerOver(d) {
  const w = { onmessage: null, onerror: null, posted: [], terminate: vi.fn() }
  const core = createWorkerCore({
    tabId: 'T', locks: null, makeChannel: null, makeIO: async () => memoryIO(d), fetchFn: vi.fn(),
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
    expect(a.build).toBe('2026-11-19T22:00:00Z')
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
})
