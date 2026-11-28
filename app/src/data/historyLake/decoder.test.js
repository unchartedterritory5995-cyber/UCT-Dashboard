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
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import fixture from './__fixtures__/source.json'
import { parsePrefix, PieceError } from './piece'
import { createHistorySource, HEADER_NAME } from './source'
import { createLakeDecoder, decodePieceColumns, decodeReply, DECODE_WORKER_OFF_KEY } from './decoder'
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
function fakeWorkerFactory({ ready = true, failOn = null } = {}) {
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
        }, 0)
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

afterEach(() => { vi.unstubAllGlobals() })

describe('lake pieces decode off the main thread', () => {
  it('W1 a source decodes every piece through its decoder, and the bars are the reference bars', async () => {
    const f = fakeWorkerFactory()
    const dec = createLakeDecoder({ makeWorker: f.make, disabled: () => false })
    const spy = vi.spyOn(dec, 'decode')
    const src = createHistorySource({ fetch: edge(), decoder: dec, yieldTask: null })
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
    const src = createHistorySource({ fetch: edge(), decoder: dec, yieldTask: null })
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
