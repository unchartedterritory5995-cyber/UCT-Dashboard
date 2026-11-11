import { describe, expect, it, vi } from 'vitest'
import { ingestShard } from './barsPackIngest'
import { createPackWorkerClient, IDLE_TERMINATE_MS } from './barsPackWorkerClient'

const SHARD = { tickers: { AAPL: { D: { t: [1, 2], o: [1, 1], h: [2, 2], l: [0, 0], c: [1.5, 1.6], v: [10, 11] } } } }
const okFetch = (body = SHARD) => vi.fn(async () => ({ ok: true, json: async () => body }))
const JOB = { url: 'https://x/api/barspack/v/0', batchSize: 60, yieldBetween: true, replaceIfNewer: false }

describe('ingestShard (the one job the worker and the page share)', () => {
  it('imports a shard and reports what was written', async () => {
    const importPack = vi.fn(async (entries) => ({ written: entries.length, aborted: false }))
    const res = await ingestShard(JOB, { fetchImpl: okFetch(), importPack })
    expect(res).toEqual({ status: 'ok', written: 1, aborted: false })
    expect(importPack.mock.calls[0][1]).toEqual({ batchSize: 60, yieldBetween: true, replaceIfNewer: false })
  })

  it('sends the session cookie (the eleven-day outage was credentials: omit)', async () => {
    const f = okFetch()
    await ingestShard(JOB, { fetchImpl: f, importPack: async () => ({ written: 1 }) })
    expect(f).toHaveBeenCalledWith(JOB.url, { credentials: 'same-origin' })
  })

  it('a non-ok response and a shard with no series are both "empty", never a success', async () => {
    const importPack = vi.fn()
    expect((await ingestShard(JOB, { fetchImpl: async () => ({ ok: false }), importPack })).status).toBe('empty')
    expect((await ingestShard(JOB, { fetchImpl: okFetch({ tickers: {} }), importPack })).status).toBe('empty')
    expect(importPack).not.toHaveBeenCalled()
  })

  it('a thrown fetch is fetch-failed and a thrown import is import-failed', async () => {
    expect((await ingestShard(JOB, { fetchImpl: async () => { throw new Error('offline') } })).status).toBe('fetch-failed')
    expect((await ingestShard(JOB, { fetchImpl: okFetch(), importPack: async () => { throw new Error('quota') } })).status).toBe('import-failed')
  })

  it('passes a quota abort through', async () => {
    const res = await ingestShard(JOB, { fetchImpl: okFetch(), importPack: async () => ({ written: 3, aborted: true }) })
    expect(res).toEqual({ status: 'ok', written: 3, aborted: true })
  })
})

function fakeWorker() {
  const w = { posted: [], terminated: false, onmessage: null, onerror: null }
  w.postMessage = (m) => w.posted.push(m)
  w.terminate = () => { w.terminated = true }
  w.reply = (i, res) => w.onmessage({ data: { id: w.posted[i].id, ...res } })
  return w
}
function timers() {
  const list = []
  return { setTimer: (fn, ms) => { list.push({ fn, ms }); return list.length }, clearTimer: (id) => { if (list[id - 1]) list[id - 1].fn = null }, fire: () => list.splice(0).forEach((t) => t.fn?.()), list }
}

describe('createPackWorkerClient', () => {
  it('runs jobs in the worker, matching replies by id, and never on the main thread', async () => {
    const w = fakeWorker()
    const runOnMain = vi.fn()
    const c = createPackWorkerClient({ makeWorker: () => w, runOnMain, ...timers() })
    const a = c.run({ url: 'https://x/a' })
    const b = c.run({ url: 'https://x/b' })
    expect(w.posted.map((m) => m.job.url)).toEqual(['https://x/a', 'https://x/b'])
    w.reply(1, { status: 'ok', written: 2, aborted: false })
    w.reply(0, { status: 'empty', written: 0, aborted: false })
    expect(await a).toEqual({ status: 'empty', written: 0, aborted: false })
    expect(await b).toEqual({ status: 'ok', written: 2, aborted: false })
    expect(runOnMain).not.toHaveBeenCalled()
  })

  it('falls back to the main thread when no worker can start', async () => {
    const runOnMain = vi.fn(async () => ({ status: 'ok', written: 1, aborted: false }))
    const c = createPackWorkerClient({ makeWorker: () => { throw new Error('no Worker') }, runOnMain, ...timers() })
    expect(await c.run({ url: 'a' })).toEqual({ status: 'ok', written: 1, aborted: false })
    expect(c.isDead()).toBe(true)
  })

  it('a worker that errors hands its in-flight jobs to the main thread, and is not used again', async () => {
    const w = fakeWorker()
    let made = 0
    const runOnMain = vi.fn(async (job) => ({ status: 'ok', written: job.url.length - 'https://x/'.length, aborted: false }))
    const c = createPackWorkerClient({ makeWorker: () => { made++; return w }, runOnMain, ...timers() })
    const a = c.run({ url: 'https://x/aa' })
    w.onerror(new Event('error'))
    expect(await a).toEqual({ status: 'ok', written: 2, aborted: false })
    expect(w.terminated).toBe(true)
    await c.run({ url: 'https://x/bbb' })
    expect(made).toBe(1)
    expect(runOnMain).toHaveBeenCalledTimes(2)
  })

  it('a postMessage that throws runs that job on the main thread', async () => {
    const w = fakeWorker()
    w.postMessage = () => { throw new Error('DataCloneError') }
    const runOnMain = vi.fn(async () => ({ status: 'ok', written: 1, aborted: false }))
    const c = createPackWorkerClient({ makeWorker: () => w, runOnMain, ...timers() })
    expect((await c.run({ url: 'a' })).status).toBe('ok')
    expect(c.inFlight()).toBe(0)
  })

  it('terminates the worker after it has been idle, and starts a fresh one for a later job', async () => {
    const t = timers()
    const workers = []
    const c = createPackWorkerClient({ makeWorker: () => { const w = fakeWorker(); workers.push(w); return w }, runOnMain: vi.fn(), ...t })
    const a = c.run({ url: 'a' })
    workers[0].reply(0, { status: 'ok', written: 1, aborted: false })
    await a
    expect(t.list.at(-1).ms).toBe(IDLE_TERMINATE_MS)
    t.fire()
    expect(workers[0].terminated).toBe(true)
    expect(c.hasWorker()).toBe(false)
    c.run({ url: 'b' })
    expect(workers.length).toBe(2)
  })

  it('does not terminate while a job is still in flight', async () => {
    const t = timers()
    const w = fakeWorker()
    const c = createPackWorkerClient({ makeWorker: () => w, runOnMain: vi.fn(), ...t })
    const a = c.run({ url: 'a' })
    c.run({ url: 'b' })
    w.reply(0, { status: 'ok', written: 1, aborted: false })
    await a
    t.fire()
    expect(w.terminated).toBe(false)
  })
})

describe('the worker module', () => {
  it('replies with the job id and the shard result', async () => {
    const posted = []
    const g = globalThis
    const prevSelf = g.self
    g.self = { postMessage: (m) => posted.push(m) }
    vi.resetModules()
    vi.doMock('./barsPackIngest', () => ({ ingestShard: async (job) => ({ status: 'ok', written: job.n, aborted: false }) }))
    await import('./barsPack.worker.js')
    await g.self.onmessage({ data: { id: 7, job: { n: 4 } } })
    expect(posted).toEqual([{ id: 7, status: 'ok', written: 4, aborted: false }])
    vi.doUnmock('./barsPackIngest')
    g.self = prevSelf
  })
})

describe('job URLs', () => {
  it('a relative pack route reaches the worker as an absolute URL on the page origin', () => {
    const w = fakeWorker()
    const c = createPackWorkerClient({ makeWorker: () => w, runOnMain: vi.fn(), setTimer: () => 1, clearTimer: () => {} })
    c.run({ url: '/api/barspack/v/3' })
    expect(w.posted[0].job.url).toBe(new URL('/api/barspack/v/3', globalThis.location.href).href)
    expect(w.posted[0].job.url).toMatch(/^https?:\/\//)
  })
})
