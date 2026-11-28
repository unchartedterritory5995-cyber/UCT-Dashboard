// @vitest-environment node
/**
 * LAKE PIECES DECODE OFF THE MAIN THREAD (section 3.3 change 5, 2026-11-28).
 *
 * Measured (cold-arch rig on a local build of master 886bbe212d, a typed Enter on a cold 15m ticker, CPU profile mapped to
 * source): `decodeColumns` + `toFloats` ran on the main thread between the key and the frame, 9.3 ms of loadPiece in that
 * press, and every deeper piece after the paint was a main-thread task of its own. decoder.js runs the same two functions
 * in a worker and hands back the same columns.
 *   W1 a source decodes every piece through its decoder (none on the page once the worker is ready), and the bars are the
 *      bars the inline decode gives (the Python reference's) (red before the change: the page decoded every piece itself)
 *   W2 the worker's answer is bit for bit the inline decode's, for every fixture piece; the caller's bytes stay readable
 *      (a shared body is never detached); a corrupt body rejects PieceError with the inline decode's message
 *   W3 before the worker says it is ready a decode runs inline (a first frame never waits for a worker to start), and the
 *      source asks the worker to start when it asks an index
 *   W4 a worker that errors finishes its decodes in flight inline (the same columns) and every later decode is inline
 *   W5 the switch ('0') and a platform with no Worker decode inline
 *   W6 the app's default: a source made with no decoder uses the page's shared one, which uses a Worker where one exists
 * Review of #2954 (a paint-awaited decode queued behind another load's deep pieces; aborted loads still decoded):
 *   Q1 a paint-awaited load's pieces never wait behind background jobs: decoded inline at once, the same bars, while
 *      the worker still holds the background ones (red before: they queued behind them in the worker)
 *   Q2 the page keeps the queue: at most WORKER_IN_FLIGHT jobs are posted at once, and every job is answered
 *   Q3 a job whose load is given up while it waits in the page's queue is never posted nor decoded; it rejects with the
 *      abort; the source's loadBars rejects AbortError
 *   Q4 a worker that dies with jobs waiting in the page's queue decodes the live ones inline and drops the aborted ones
 *   Q5 a queued job whose load becomes paint-awaited (network.js lakeAwaited, later) is posted ahead of the rest
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import fixture from './__fixtures__/source.json'
import { parsePrefix, PieceError } from './piece'
import { createHistorySource, HEADER_NAME } from './source'
import { createLakeDecoder, decodePieceColumns, decodeReply, DECODE_WORKER_OFF_KEY, WORKER_IN_FLIGHT } from './decoder'
import zlib from 'node:zlib'

const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
const pieces = fixture.pieces.map((p) => {
  const data = bytesOf(p.b64)
  const { header, offset } = parsePrefix(data)
  return { relpath: p.relpath, headerJson: JSON.stringify(header), body: new Uint8Array(zlib.brotliDecompressSync(data.subarray(offset))) }
})

function edge() {
  const byPath = new Map(pieces.map((p) => [`/api/hist/${p.relpath}`, p]))
  return async (url) => {
    const [path] = url.split('?')
    if (path === `/api/hist/${fixture.index_relpath}`) return new Response(JSON.stringify(fixture.index), { status: 200 })
    const p = byPath.get(path)
    if (!p) return new Response('{}', { status: 404 })
    return new Response(p.body.slice(), { status: 200, headers: { [HEADER_NAME]: p.headerJson } })
  }
}
const want = fixture.expected['5']
const expectBars = (got) => {
  expect(Array.from(got.t)).toEqual(want.raw.t)
  for (const k of ['o', 'h', 'l', 'c', 'v']) expect(Array.from(got[k])).toEqual(want.adjusted[k])
}

/** A worker double that runs decode.worker.js's handler for real, a task later, through a structured clone with the
 *  transfer list (so a transferred buffer is detached on the sending side, as in a browser). */
function fakeWorkerFactory({ ready = true, failOn = null, delay = 0 } = {}) {
  const made = []
  const make = () => {
    const w = {
      posted: 0, terminated: false, onmessage: null, onerror: null,
      postMessage(data, transfer = []) {
        const n = (w.posted += 1)
        const sent = structuredClone(data, { transfer })
        setTimeout(() => {
          if (w.terminated) return
          if (failOn && failOn(n)) { w.onerror?.({ preventDefault() {} }); return }
          const { msg, transfer: back } = decodeReply(sent)
          w.onmessage?.({ data: structuredClone(msg, { transfer: back }) })
        }, delay)
      },
      terminate() { w.terminated = true },
      sayReady() { w.onmessage?.({ data: { ready: true } }) },
    }
    made.push(w)
    if (ready) setTimeout(() => w.sayReady(), 0)
    return w
  }
  return { make, made }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
/** A background load's yield (network.js: `nextTask()` unless a paint awaits the load). */
const background = () => Promise.resolve()

afterEach(() => { vi.unstubAllGlobals() })

describe('lake pieces decode off the main thread', () => {
  it('W1 a source decodes every piece through its decoder, and the bars are the reference bars', async () => {
    const f = fakeWorkerFactory()
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    const spy = vi.spyOn(dec, 'decode')
    const src = createHistorySource({ fetch: edge(), decoder: dec, yieldTask: background })
    await src.loadIndex('MU-LT')            // the index asks the worker to start ...
    await tick(); await tick()              // ... and it says it is ready
    const got = await src.loadBars('MU-LT', '5')
    expectBars(got)
    expect(spy).toHaveBeenCalledTimes(3)
    expect(dec.stats()).toMatchObject({ worker: 3, inline: 0, fallback: 0, ready: true })
    expect(f.made[0].posted).toBe(3)
  })

  it('W2 the worker answers the inline decode bit for bit; the caller keeps its bytes; a corrupt body is a PieceError', async () => {
    const f = fakeWorkerFactory()
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    for (const p of pieces) {
      const mine = p.body.slice()
      const got = await dec.decode(p.headerJson, mine)
      const ref = decodePieceColumns(p.headerJson, p.body)
      expect(got.header).toEqual(ref.header)
      for (const k of ['t', 'o', 'h', 'l', 'c', 'v', 'n']) {
        expect(got[k]).toBeInstanceOf(Float64Array)
        expect(new Uint8Array(got[k].buffer, got[k].byteOffset, got[k].byteLength)).toEqual(new Uint8Array(ref[k].buffer, ref[k].byteOffset, ref[k].byteLength))
      }
      expect(mine.byteLength).toBe(p.body.byteLength)   // not detached
      expect(mine).toEqual(p.body)
    }
    const bad = pieces[0].body.slice(); bad[bad.length - 1] ^= 0xff
    let inline = null
    try { decodePieceColumns(pieces[0].headerJson, bad) } catch (e) { inline = e }
    expect(inline).toBeInstanceOf(PieceError)
    let viaWorker = null
    try { await dec.decode(pieces[0].headerJson, bad) } catch (e) { viaWorker = e }
    expect(viaWorker).toBeInstanceOf(PieceError)
    expect(viaWorker.message).toBe(inline.message)
  })

  it('W3 before the worker is ready a decode is inline; the source asks the worker to start at its index', async () => {
    const f = fakeWorkerFactory({ ready: false })
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    const src = createHistorySource({ fetch: edge(), decoder: dec, yieldTask: null })
    await src.loadIndex('MU-LT')
    expect(f.made).toHaveLength(1)                       // started at the index, before any piece
    const got = await src.loadBars('MU-LT', '5')
    expectBars(got)
    expect(dec.stats()).toMatchObject({ inline: 3, worker: 0, ready: false })
    const p = pieces[0]
    const out = dec.decode(p.headerJson, p.body)
    expect(typeof out.then).toBe('undefined')            // an object at once, not a promise
    f.made[0].sayReady()
    const later = dec.decode(p.headerJson, p.body)
    expect(typeof later.then).toBe('function')
    expect(Array.from((await later).c)).toEqual(Array.from(out.c))
  })

  it('W4 a worker that errors finishes its decodes inline, and every later decode is inline', async () => {
    const f = fakeWorkerFactory({ failOn: (n) => n === 2 })
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    const src = createHistorySource({ fetch: edge(), decoder: dec, yieldTask: background })
    const got = await src.loadBars('MU-LT', '5')
    expectBars(got)
    const s = dec.stats()
    expect(s.dead).toBe(true)
    expect(s.fallback).toBeGreaterThanOrEqual(1)
    expect(f.made[0].terminated).toBe(true)
    const again = dec.decode(pieces[0].headerJson, pieces[0].body)
    expect(typeof again.then).toBe('undefined')
    expect(f.made).toHaveLength(1)                       // never restarted
  })

  it('W5 the switch and a platform with no Worker decode inline', async () => {
    const f = fakeWorkerFactory()
    let off = true
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => off })
    dec.warm(); await tick()
    expect(f.made).toHaveLength(0)
    const r = dec.decode(pieces[0].headerJson, pieces[0].body)
    expect(typeof r.then).toBe('undefined')
    off = false
    dec.warm(); await tick()
    expect(typeof dec.decode(pieces[0].headerJson, pieces[0].body).then).toBe('function')
    const none = createLakeDecoder({ makeWorker: null })
    none.warm()
    expect(typeof none.decode(pieces[0].headerJson, pieces[0].body).then).toBe('undefined')
    // the stored switch is read by the default
    const store = new Map([[DECODE_WORKER_OFF_KEY, '0']])
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null })
    const g = fakeWorkerFactory()
    const byKey = createLakeDecoder({ makeWorker: g.make })
    byKey.warm()
    expect(g.made).toHaveLength(0)
  })

  it('Q1 a paint-awaited decode never waits behind background jobs', async () => {
    const f = fakeWorkerFactory({ delay: 25 })   // each worker decode takes 25 ms: A's twelve hold it for ~150 ms
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    // ticker A's deep history: background pieces handed to the decoder (they wait in the worker / the page queue)
    const P = (i) => pieces[i % pieces.length]
    const deep = Array.from({ length: 12 }, (_, i) => dec.decode(P(i).headerJson, P(i).body))
    expect(deep.every((d) => typeof d.then === 'function')).toBe(true)
    // ticker B's first paint: its load's yield answers nothing (network.js: a paint awaits the load)
    const src = createHistorySource({ fetch: edge(), decoder: dec })
    const got = await src.loadBars('MU-LT', '5', { yieldTask: () => null })
    expectBars(got)
    const s = dec.stats()
    expect(s.urgentInline).toBe(3)                       // all three of B's pieces, at once
    expect(s.pending + s.queued).toBeGreaterThan(0)      // A's pieces were still waiting when B's bars were ready
    const all = await Promise.all(deep)
    expect(all.map((d) => d.header.period)).toEqual(Array.from({ length: 12 }, (_, i) => JSON.parse(P(i).headerJson).period))
    // with the worker idle, a paint-awaited decode goes to the worker (nothing to wait behind)
    const idle = dec.decode(pieces[0].headerJson, pieces[0].body, { urgent: true })
    expect(typeof idle.then).toBe('function')
    await idle
  })

  it('Q2 at most WORKER_IN_FLIGHT jobs are posted at once, and every job is answered', async () => {
    const f = fakeWorkerFactory()
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    const P = (i) => pieces[i % pieces.length]
    const jobs = Array.from({ length: 9 }, (_, i) => dec.decode(P(i).headerJson, P(i).body))
    expect(f.made[0].posted).toBe(WORKER_IN_FLIGHT)
    expect(dec.stats()).toMatchObject({ pending: WORKER_IN_FLIGHT, queued: 9 - WORKER_IN_FLIGHT })
    let most = 0
    const watch = setInterval(() => { most = Math.max(most, dec.stats().pending) }, 0)
    const out = await Promise.all(jobs)
    clearInterval(watch)
    expect(most).toBeLessThanOrEqual(WORKER_IN_FLIGHT)
    expect(out).toHaveLength(9)
    expect(f.made[0].posted).toBe(9)
    expect(dec.stats()).toMatchObject({ pending: 0, queued: 0, worker: 9, inline: 0, fallback: 0 })
  })

  it('Q3 a job given up while it waits in the page queue is never decoded', async () => {
    const f = fakeWorkerFactory()
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    const ac = new AbortController()
    const live = Array.from({ length: WORKER_IN_FLIGHT }, () => dec.decode(pieces[0].headerJson, pieces[0].body))
    const gone = Array.from({ length: 5 }, () => dec.decode(pieces[1].headerJson, pieces[1].body, { signal: ac.signal }))
    ac.abort()
    for (const g of gone) await expect(g).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.all(live)
    await tick(); await tick()
    expect(f.made[0].posted).toBe(WORKER_IN_FLIGHT)    // the given-up ones never reached the worker
    expect(dec.stats()).toMatchObject({ dropped: 5, queued: 0, pending: 0 })
    // already aborted: rejected without queueing
    await expect(dec.decode(pieces[0].headerJson, pieces[0].body, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    // through the source: a background load aborted while its pieces wait rejects AbortError, its waiting pieces undecoded
    const busy = Array.from({ length: WORKER_IN_FLIGHT }, () => dec.decode(pieces[0].headerJson, pieces[0].body))
    const ac2 = new AbortController()
    const src = createHistorySource({ fetch: edge(), decoder: dec, yieldTask: background })
    const load = src.loadBars('MU-LT', '5', { signal: ac2.signal })
    const before = f.made[0].posted
    for (let i = 0; i < 50 && dec.stats().queued < 3; i++) await new Promise((r) => setImmediate(r))
    expect(dec.stats().queued).toBe(3)                   // B's three pieces wait behind the busy worker
    ac2.abort()
    await expect(load).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.all(busy)
    await tick(); await tick()
    expect(f.made[0].posted - before).toBe(0)           // none of them was posted
    expect(dec.stats()).toMatchObject({ dropped: 8, queued: 0 })
  })

  it('Q5 a queued job whose load becomes paint-awaited goes to the worker ahead of the rest', async () => {
    const f = fakeWorkerFactory({ delay: 10 })
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    const order = []
    let awaited = false
    const P = (i) => pieces[i % pieces.length]
    const bg = Array.from({ length: 8 }, (_, i) => dec.decode(P(i).headerJson, P(i).body).then(() => order.push(`bg${i}`)))
    const late = dec.decode(P(0).headerJson, P(0).body, { isUrgent: () => awaited }).then(() => order.push('late'))
    awaited = true                                         // network.js: the handoff now waits on this load
    await Promise.all([...bg, late])
    // the two posted before the flip finish first; the awaited job is the next one posted
    expect(order.indexOf('late')).toBeLessThanOrEqual(WORKER_IN_FLIGHT)
    // through the source: the yield's own urgentNow reaches the decoder
    const spy = vi.spyOn(dec, 'decode')
    const src = createHistorySource({ fetch: edge(), decoder: dec })
    const wait = () => Promise.resolve()
    wait.urgentNow = () => false
    await src.loadBars('MU-LT', '5', { yieldTask: wait })
    expect(spy.mock.calls.every((c) => c[2].isUrgent === wait.urgentNow)).toBe(true)
  })

  it('Q4 a worker that dies with jobs queued decodes the live ones inline and drops the aborted ones', async () => {
    const f = fakeWorkerFactory({ failOn: (n) => n === 1 })
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    const P = (i) => pieces[i % pieces.length]
    const ac = new AbortController()
    const live = Array.from({ length: 4 }, (_, i) => dec.decode(P(i).headerJson, P(i).body))
    const gone = dec.decode(pieces[0].headerJson, pieces[0].body, { signal: ac.signal })
    ac.abort()
    await expect(gone).rejects.toMatchObject({ name: 'AbortError' })
    const out = await Promise.all(live)
    for (let i = 0; i < 4; i++) expect(Array.from(out[i].c)).toEqual(Array.from(decodePieceColumns(P(i).headerJson, P(i).body).c))
    expect(dec.stats().dead).toBe(true)
  })

  it('Q6 a job given up after it was posted is not decoded inline when the worker dies under it', async () => {
    const f = fakeWorkerFactory({ failOn: (n) => n === 1, delay: 20 })
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    dec.warm(); await tick()
    const ac = new AbortController()
    const posted = dec.decode(pieces[0].headerJson, pieces[0].body, { signal: ac.signal })
    expect(dec.stats().pending).toBe(1)                  // in the worker, not in the page queue
    ac.abort()                                           // given up while the worker holds it
    await expect(posted).rejects.toMatchObject({ name: 'AbortError' })
    expect(dec.stats()).toMatchObject({ dead: true, dropped: 1, fallback: 0 })
  })

  it('W6 the default source uses the page decoder, and the page decoder uses a Worker where one exists', async () => {
    const made = []
    class FakeWorker {
      constructor(url, opts) { this.url = String(url); this.opts = opts; made.push(this) }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    vi.resetModules()
    const { createHistorySource: fresh } = await import('./source')
    const src = fresh({ fetch: edge(), yieldTask: null })
    await src.loadIndex('MU-LT')
    expect(made).toHaveLength(1)
    expect(made[0].url).toMatch(/decode\.worker\.js/)
    expect(made[0].opts).toEqual({ type: 'module' })
    vi.resetModules()
  })
})
