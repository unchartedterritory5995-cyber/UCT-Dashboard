// @vitest-environment node
// THE INGEST'S OPERATIONS (review of #2537: M5, M7, L3, and the engine half of M2). What a member's browser pays when
// things go wrong, bounded:
//   M5  a browser that cannot hold the seed is never looped on: no download without room for the pack plus a margin,
//       a partial file the disk refused is removed (never resumed), and a persisted "not here" marker with an expiry
//       keeps the next page loads from trying again for a while
//   M7  a pack that fails its checks is retried with a backoff across page loads (1 h, then 6 h, then never again
//       for that build); a new build clears it, and so does a new CLIENT (the record names the worker code that
//       failed it: review of #2537 head 107dea1ee1, P-5)
//   L3  pack and delta downloads never keep a second copy in the browser's HTTP cache, and ask for LOW priority
//       (review of #2537 head 107dea1ee1, P-4: the first ~80 MB download must yield to the charts' own requests)
//   M2  serves(): does any held timeframe still pass the split guard today (the leader stops the minute feed when not)
// The numbers are LITERALS here, pinned once against the engine's exports, so a changed constant is a red line by name.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import FIX from './__fixtures__/ffseed_delta.json'
import * as E from './engine'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const { createDeviceEngine } = E
const sha = (b) => createHash('sha256').update(b).digest('hex')
const MB = 1024 * 1024
const HOUR = 3_600_000
const DAYMS = 24 * HOUR
const MARGIN = 256 * MB                       // HEADROOM_MARGIN_BYTES
const NO_ROOM_RETRY = 3 * DAYMS               // NO_ROOM_RETRY_MS
const STATE_FILE = 'ingest.json'              // INGEST_STATE_FILE
/** 18:00 ET on the packs' as-of day (seedPackOf's default, 2026-11-18): the seed's own basis holds. */
const T0 = Date.UTC(2026, 10, 18, 23, 0)

const DAY = 86400
const D0 = Date.UTC(2025, 0, 6) / 1000
function dailyRows(n, seed = 1) {
  const days = []
  for (let t = D0; days.length < n; t += DAY) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(t) }
  return synthBars(n, { seed }).map((r, i) => ({ ...r, t: days[i] }))
}
const UNIVERSE = { AAPL: dailyRows(350, 1), MSFT: dailyRows(350, 2), NVDA: dailyRows(350, 3) }
const packOf = (syms, o = {}) => seedPackOf(syms, { build: 'b1', ...o })
const entryOf = (tf, url, bytes, build = 'b1') => ({ tf, url, bytes: bytes.length, sha256: sha(bytes), build })

/** A fetch serving `files` (url → bytes) in 1 KB chunks, recording [url, init] of every call. */
function fakeEdge(files) {
  const calls = []
  const fetchFn = vi.fn(async (url, init = {}) => {
    calls.push([url, init])
    const bytes = files[url]
    if (!bytes) return new Response('nope', { status: 404 })
    const m = /bytes=(\d+)-/.exec(init.headers?.Range || '')
    const start = m ? Number(m[1]) : 0
    const part = bytes.subarray(start)
    const chunks = []
    for (let i = 0; i < part.length; i += 1024) chunks.push(part.slice(i, Math.min(part.length, i + 1024)))
    const body = new ReadableStream({ pull(ctl) { if (chunks.length) ctl.enqueue(chunks.shift()); else ctl.close() } })
    return new Response(body, start ? { status: 206, headers: { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } } : { status: 200 })
  })
  fetchFn.calls = calls
  fetchFn.urls = () => calls.map(([u]) => u)
  return fetchFn
}

/** memoryIO whose handles on `name` accept `after` writes, then refuse the way `how` says: 'quota' (the disk is full:
 *  QuotaExceededError), 'short' (fewer bytes written than given) or 'other' (any other failure). */
function refusingIO(disk, name, { after = 1, how = 'quota' } = {}) {
  const io = memoryIO(disk)
  const open = io.open.bind(io)
  io.open = async (n, o) => {
    const h = await open(n, o)
    if (n !== name) return h
    let k = 0
    return {
      ...h,
      write(u8, at) {
        if (++k <= after) return h.write(u8, at)
        if (how === 'quota') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        if (how === 'short') return h.write(u8.subarray(0, u8.length - 1), at)
        throw new Error('the disk said no')
      },
    }
  }
  return io
}

const packFiles = (disk) => [...disk.keys()].filter((n) => /\.(pack|ok|prog)$/.test(n)).sort()
const roomFor = (free) => async () => ({ quota: 4096 * MB, usage: 4096 * MB - free })

describe('the numbers', () => {
  it('margin 256 MiB, no-room retry 3 days, bad-pack retries after 1 h then 6 h, 3 tries per build', () => {
    expect(E.HEADROOM_MARGIN_BYTES).toBe(MARGIN)
    expect(E.NO_ROOM_RETRY_MS).toBe(NO_ROOM_RETRY)
    expect(E.BAD_PACK_RETRY_MS).toEqual([HOUR, 6 * HOUR])
    expect(E.BAD_PACK_MAX_TRIES).toBe(3)
    expect(E.INGEST_STATE_FILE).toBe(STATE_FILE)
  })
})

describe('M5 storage headroom', () => {
  it('no download without room for the pack plus the margin; the status says why, and nothing is left on disk', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const edge = fakeEdge({ u: pack })
    const estimate = vi.fn(roomFor(pack.length + MARGIN - 1))
    const eng = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: edge, estimate })
    const r = await eng.ingest(entryOf('D', 'u', pack))
    expect(r).toMatchObject({ tf: 'D', status: 'no-room', why: 'headroom', need: pack.length + MARGIN, free: pack.length + MARGIN - 1, until: T0 + NO_ROOM_RETRY })
    expect(estimate).toHaveBeenCalledTimes(1)
    expect(edge).not.toHaveBeenCalled()
    expect(packFiles(disk)).toEqual([])
    expect(eng.read('AAPL', 'D')).toBeNull()
    expect(eng.ingestBlocked()).toMatchObject({ status: 'no-room', until: T0 + NO_ROOM_RETRY })
  })

  it('CONTROL: exactly the pack plus the margin downloads; an estimate the browser cannot give never blocks', async () => {
    const pack = packOf(UNIVERSE)
    for (const estimate of [roomFor(pack.length + MARGIN), async () => null, async () => { throw new Error('no') }, async () => ({ usage: 1 })]) {
      const eng = createDeviceEngine({ now: () => T0, io: memoryIO(), fetchFn: fakeEdge({ u: pack }), estimate })
      expect(await eng.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
      expect(eng.ingestBlocked()).toBeNull()
    }
  })

  it('the next page loads do not try again (not even the estimate) until the marker expires', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    let t = T0
    const first = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: fakeEdge({ u: pack }), estimate: roomFor(10 * MB) })
    expect(await first.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'no-room' })
    first.close()
    // the next page load: a new engine over the same disk
    const edge = fakeEdge({ u: pack })
    const estimate = vi.fn(roomFor(4000 * MB))
    t = T0 + NO_ROOM_RETRY - 1
    const next = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge, estimate })
    await next.open()
    expect(next.ingestBlocked()).toMatchObject({ status: 'no-room', why: 'headroom', until: T0 + NO_ROOM_RETRY })
    expect(await next.ingest(entryOf('D', 'u', pack))).toMatchObject({ tf: 'D', status: 'no-room' })
    expect(await next.ingestAll({ v: 1, kind: 'ffseed', build: 'b1', tfs: { D: { url: 'u', bytes: pack.length, sha256: sha(pack) } } })).toEqual([expect.objectContaining({ status: 'no-room' })])
    expect(estimate).not.toHaveBeenCalled()
    expect(edge).not.toHaveBeenCalled()
    // expired: one more try, which now finds room
    t = T0 + NO_ROOM_RETRY
    expect(next.ingestBlocked()).toBeNull()
    expect(await next.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
    expect(estimate).toHaveBeenCalledTimes(1)
  })

  it('ingestAll stops at the first timeframe without room: no other pack is downloaded', async () => {
    const d = packOf(UNIVERSE, { build: 'b9' })
    const m5 = packOf({ AAPL: synthBars(300, { step: 300, t0: Date.UTC(2026, 10, 18, 20, 55) / 1000 - 299 * 300 }) }, { tf: '5', build: 'b9' })
    const edge = fakeEdge({ 'https://x.test/seed/D.pack': d, 'https://x.test/seed/5.pack': m5 })
    const eng = createDeviceEngine({ now: () => T0, io: memoryIO(), fetchFn: edge, estimate: roomFor(MB) })
    const out = await eng.ingestAll({ v: 1, build: 'b9', tfs: {
      D: { url: 'D.pack', bytes: d.length, sha256: sha(d) },
      '5': { url: '5.pack', bytes: m5.length, sha256: sha(m5) },
    } }, { base: 'https://x.test/seed/manifest.json' })
    expect(out.map((r) => [r.tf, r.status])).toEqual([['D', 'no-room']])
    expect(edge).not.toHaveBeenCalled()
  })

  it.each([['quota', 'QuotaExceededError'], ['short', 'a short write']])(
    'a write the disk refuses (%s) keeps NO partial file, marks the browser, and the held copy keeps serving', async (how) => {
      const one = packOf(UNIVERSE)
      const two = packOf({ AAPL: dailyRows(350, 42), MSFT: dailyRows(350, 43), NVDA: dailyRows(350, 44) }, { build: 'b2' })
      const disk = new Map()
      const edge = fakeEdge({ u1: one, u2: two })
      const eng = createDeviceEngine({ now: () => T0, io: refusingIO(disk, 'D.2.pack', { after: 1, how }), fetchFn: edge })
      expect(await eng.ingest(entryOf('D', 'u1', one))).toMatchObject({ status: 'ingested' })
      const held = Array.from(eng.read('AAPL', 'D').c)
      const r = await eng.ingest(entryOf('D', 'u2', two, 'b2'))
      expect(r).toMatchObject({ tf: 'D', status: 'no-room', why: 'write', until: T0 + NO_ROOM_RETRY })
      expect(packFiles(disk)).toEqual(['D.1.ok', 'D.1.pack'])            // the partial and its .prog are gone
      expect(Array.from(eng.read('AAPL', 'D').c)).toEqual(held)
      expect(eng.info().tfs.D.build).toBe('b1')
      eng.close()
      // the next page load asks nothing
      const next = createDeviceEngine({ now: () => T0 + HOUR, io: memoryIO(disk), fetchFn: edge })
      await next.open()
      expect(next.ingestBlocked()).toMatchObject({ status: 'no-room', why: 'write' })
      const calls = edge.mock.calls.length
      expect(await next.ingest(entryOf('D', 'u2', two, 'b2'))).toMatchObject({ status: 'no-room' })
      expect(edge.mock.calls.length).toBe(calls)
    })

  it('a write that fails for another reason removes the partial file too (never resumed), without the no-room marker', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const eng = createDeviceEngine({ now: () => T0, io: refusingIO(disk, 'D.1.pack', { after: 1, how: 'other' }), fetchFn: fakeEdge({ u: pack }) })
    await expect(eng.ingest(entryOf('D', 'u', pack))).rejects.toThrow(/the disk said no/)
    expect(packFiles(disk)).toEqual([])
    expect(eng.ingestBlocked()).toBeNull()
  })
})

/** The server's delta fixture (delta.test.js): one timeframe's base build, and the next build as a delta. */
const FIX_NOW = () => Date.UTC(2026, 10, 19, 23, 0)
function caseOf(tf) {
  const C = FIX.cases[tf]
  const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
  const base = bytesOf(C.base), next = bytesOf(C.new), delta = bytesOf(C.delta)
  const abs = (u) => 'https://x.test' + u
  const baseEntry = { tf, build: FIX.base_build, url: abs(C.base_entry.url), bytes: base.length, sha256: sha(base) }
  const newEntry = { tf, build: FIX.build, ...C.entry, url: abs(C.entry.url), delta: { ...C.entry.delta, url: abs(C.entry.delta.url) } }
  return { baseEntry, newEntry, files: { [baseEntry.url]: base, [newEntry.url]: next, [newEntry.delta.url]: delta } }
}

describe('M5 on the delta path', () => {
  it('a delta whose new generation the disk refuses does NOT fall back to the full download', async () => {
    const k = caseOf('5')
    const disk = new Map()
    const edge = fakeEdge(k.files)
    const eng = createDeviceEngine({ now: FIX_NOW, io: refusingIO(disk, '5.2.pack', { after: 1, how: 'quota' }), fetchFn: edge })
    expect(await eng.ingest(k.baseEntry)).toMatchObject({ status: 'ingested', via: 'full' })
    const r = await eng.ingest(k.newEntry)
    expect(r).toMatchObject({ tf: '5', status: 'no-room', why: 'write' })
    expect(edge.urls()).toEqual([k.baseEntry.url, k.newEntry.delta.url])       // never the 80 MB pack
    expect(packFiles(disk)).toEqual(['5.1.ok', '5.1.pack'])
    expect(eng.info().tfs['5'].build).toBe(FIX.base_build)
  })
})

describe('M7 a pack that fails its checks is not downloaded again on every page load', () => {
  it('a sha256 mismatch: again after 1 h, then after 6 h, then never for that build; kept across page loads; a new build clears it', async () => {
    const good = packOf(UNIVERSE)
    const next = packOf({ AAPL: dailyRows(350, 77) }, { build: 'b2' })
    const disk = new Map()
    let t = T0
    const edge = fakeEdge({ u: good, u2: next })
    const eng = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge })
    const lying = { ...entryOf('D', 'u', good), sha256: 'f'.repeat(64) }   // a bad object at the edge
    await expect(eng.ingest(lying)).rejects.toThrow(/sha256/)
    expect(edge).toHaveBeenCalledTimes(1)
    t = T0 + HOUR - 1
    expect(await eng.ingest(lying)).toMatchObject({ tf: 'D', status: 'backoff', build: 'b1', tries: 1, until: T0 + HOUR })
    expect(edge).toHaveBeenCalledTimes(1)
    t = T0 + HOUR
    await expect(eng.ingest(lying)).rejects.toThrow(/sha256/)
    expect(edge).toHaveBeenCalledTimes(2)
    const t2 = t
    t = t2 + 6 * HOUR - 1
    expect(await eng.ingest(lying)).toMatchObject({ status: 'backoff', tries: 2, until: t2 + 6 * HOUR })
    t = t2 + 6 * HOUR
    await expect(eng.ingest(lying)).rejects.toThrow(/sha256/)
    expect(edge).toHaveBeenCalledTimes(3)
    t += 30 * DAYMS
    expect(await eng.ingest(lying)).toMatchObject({ status: 'backoff', tries: 3, until: null })
    expect(edge).toHaveBeenCalledTimes(3)
    expect(packFiles(disk)).toEqual([])
    // the next page load reads the record from disk
    const again = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge })
    expect(await again.ingest(lying)).toMatchObject({ status: 'backoff', tries: 3 })
    expect(edge).toHaveBeenCalledTimes(3)
    // the next build is not held to it
    expect(await again.ingest(entryOf('D', 'u2', next, 'b2'))).toMatchObject({ status: 'ingested' })
    expect(edge).toHaveBeenCalledTimes(4)
    expect(again.info().tfs.D.build).toBe('b2')
  })

  it('a file that holds another build than the manifest names counts the same', async () => {
    const pack = packOf(UNIVERSE, { build: '20261118T0131Z' })
    const edge = fakeEdge({ u: pack })
    let t = T0
    const eng = createDeviceEngine({ now: () => t, io: memoryIO(), fetchFn: edge })
    const e = entryOf('D', 'u', pack, '20261119T0131Z')
    await expect(eng.ingest(e)).rejects.toThrow(/build/)
    t = T0 + 30 * 60_000
    expect(await eng.ingest(e)).toMatchObject({ status: 'backoff', tries: 1 })
    expect(edge).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: an interrupted download is not a bad pack (it resumes at once, no backoff)', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    let cut = true
    const edge = vi.fn(async (url, init = {}) => {
      const m = /bytes=(\d+)-/.exec(init.headers?.Range || '')
      const start = m ? Number(m[1]) : 0
      const part = pack.subarray(start)
      if (cut) {
        cut = false
        let sent = false
        return new Response(new ReadableStream({ pull(ctl) { if (!sent) { sent = true; ctl.enqueue(part.slice(0, 2000)) } else ctl.error(new Error('network gone')) } }), { status: 200 })
      }
      return new Response(part, { status: 206, headers: { 'content-range': `bytes ${start}-${pack.length - 1}/${pack.length}` } })
    })
    const eng = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: edge })
    await expect(eng.ingest(entryOf('D', 'u', pack))).rejects.toThrow(/network gone/)
    expect(await eng.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
  })
})

/** An edge whose pack body ENDS CLEANLY at `cutAt` bytes (`'short'`), or runs `extra` bytes past the pack (`'long'`). */
function wrongSizeEdge(pack, how) {
  return vi.fn(async () => {
    const bytes = how === 'short' ? pack.subarray(0, pack.length - 100) : Uint8Array.from([...pack, ...new Uint8Array(3000)])
    const chunks = []
    for (let i = 0; i < bytes.length; i += 1024) chunks.push(bytes.slice(i, Math.min(bytes.length, i + 1024)))
    return new Response(new ReadableStream({ pull(ctl) { if (chunks.length) ctl.enqueue(chunks.shift()); else ctl.close() } }), { status: 200 })
  })
}

describe('M7 (review of #2563, test gaps): a body of the wrong size is a bad pack too', () => {
  it.each([['short', /bytes, the manifest says/], ['long', /longer than the manifest says/]])(
    'a body that ends %s of the manifest: discarded whole, recorded, not fetched again within the hour', async (how, err) => {
      const pack = packOf(UNIVERSE)
      const disk = new Map()
      let t = T0
      const edge = wrongSizeEdge(pack, how)
      const eng = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge })
      await expect(eng.ingest(entryOf('D', 'u', pack))).rejects.toThrow(err)
      expect(packFiles(disk)).toEqual([])                                 // never resumed
      t = T0 + 59 * 60_000
      expect(await eng.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'backoff', tries: 1, until: T0 + HOUR })
      expect(edge).toHaveBeenCalledTimes(1)
    })
})

describe('LOW-4 (review of #2563): the records never lock a browser out past their schedule', () => {
  const FAR = T0 + 365 * DAYMS                                           // a system clock a year ahead when written

  it('a "no room" written by a clock that ran ahead is capped when read: at most NO_ROOM_RETRY from that load', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const ahead = createDeviceEngine({ now: () => FAR, io: memoryIO(disk), fetchFn: fakeEdge({ u: pack }), estimate: roomFor(MB) })
    expect(await ahead.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'no-room', until: FAR + NO_ROOM_RETRY })
    ahead.close()
    let t = T0                                                            // the clock put right, the next page load
    const next = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: fakeEdge({ u: pack }), estimate: roomFor(4000 * MB) })
    await next.open()
    expect(next.ingestBlocked()).toMatchObject({ status: 'no-room', until: T0 + NO_ROOM_RETRY })
    t = T0 + NO_ROOM_RETRY
    expect(next.ingestBlocked()).toBeNull()
    expect(await next.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
  })

  it('a bad-pack backoff written by a clock that ran ahead is capped when read: at most its try\'s wait from that load', async () => {
    const good = packOf(UNIVERSE)
    const disk = new Map()
    const lying = { ...entryOf('D', 'u', good), sha256: 'f'.repeat(64) }
    const ahead = createDeviceEngine({ now: () => FAR, io: memoryIO(disk), fetchFn: fakeEdge({ u: good }) })
    await expect(ahead.ingest(lying)).rejects.toThrow(/sha256/)
    let t = T0
    const edge = fakeEdge({ u: good })
    const next = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge })
    expect(await next.ingest(lying)).toMatchObject({ status: 'backoff', tries: 1, until: T0 + HOUR })
    t = T0 + HOUR
    await expect(next.ingest(lying)).rejects.toThrow(/sha256/)
    expect(edge).toHaveBeenCalledTimes(1)
  })

  it("this build's own resumable partial is not counted against the free space (and resumes)", async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const CUT = 3000
    let cut = true
    const ranges = []
    const edge = vi.fn(async (url, init = {}) => {
      ranges.push(init.headers?.Range ?? null)
      const m = /bytes=(\d+)-/.exec(init.headers?.Range || '')
      const start = m ? Number(m[1]) : 0
      if (cut) {
        cut = false
        let sent = false
        return new Response(new ReadableStream({ pull(ctl) { if (!sent) { sent = true; ctl.enqueue(pack.slice(0, CUT)) } else ctl.error(new Error('network gone')) } }), { status: 200 })
      }
      return new Response(pack.slice(start), { status: 206, headers: { 'content-range': `bytes ${start}-${pack.length - 1}/${pack.length}` } })
    })
    const first = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: edge })
    await expect(first.ingest(entryOf('D', 'u', pack))).rejects.toThrow(/network gone/)
    expect(disk.get('D.1.pack').size).toBe(CUT)
    // CONTROL: one byte short of what the rest needs is still no room
    const tight = createDeviceEngine({ now: () => T0, io: memoryIO(new Map([...disk].map(([k, f]) => [k, { ...f, buf: f.buf.slice(), open: false }]))), fetchFn: edge, estimate: roomFor(pack.length - CUT + MARGIN - 1) })
    expect(await tight.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'no-room', need: pack.length - CUT + MARGIN })
    // room for the REST of the pack plus the margin: it resumes
    const next = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: edge, estimate: roomFor(pack.length - CUT + MARGIN) })
    expect(await next.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
    expect(ranges).toEqual([null, `bytes=${CUT}-`])
  })
})

describe('L3 no second copy in the HTTP cache, and the downloads yield to the charts', () => {
  // `priority: 'low'` (review of #2537 head 107dea1ee1, P-4): default ON starts ~80 MB of packs in a desktop member's
  // first charting minute; at low priority the browser sends the charts' own bars and stream requests first. A hint,
  // not a cap. A browser that does not know the member ignores it (an unknown dictionary member), and the edge keys
  // its copy on the URL alone (edge/bars-edge-router/seed.js edgeCacheKey), so it changes nothing there.
  it('the pack download and the delta download are both cache: no-store and priority: low', async () => {
    const k = caseOf('5')
    const edge = fakeEdge(k.files)
    const eng = createDeviceEngine({ now: FIX_NOW, io: memoryIO(), fetchFn: edge })
    await eng.ingest(k.baseEntry)
    await eng.ingest(k.newEntry)
    expect(edge.calls.map(([u, init]) => [u, init?.cache, init?.priority])).toEqual([
      [k.baseEntry.url, 'no-store', 'low'],
      [k.newEntry.delta.url, 'no-store', 'low'],
    ])
  })

  it('a resumed pack download (a Range request) is low priority too', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const CUT = 3000
    let cut = true
    const inits = []
    const edge = vi.fn(async (url, init = {}) => {
      inits.push(init)
      const m = /bytes=(\d+)-/.exec(init.headers?.Range || '')
      const start = m ? Number(m[1]) : 0
      if (cut) {
        cut = false
        let sent = false
        return new Response(new ReadableStream({ pull(ctl) { if (!sent) { sent = true; ctl.enqueue(pack.slice(0, CUT)) } else ctl.error(new Error('network gone')) } }), { status: 200 })
      }
      return new Response(pack.slice(start), { status: 206, headers: { 'content-range': `bytes ${start}-${pack.length - 1}/${pack.length}` } })
    })
    const first = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: edge })
    await expect(first.ingest(entryOf('D', 'u', pack))).rejects.toThrow(/network gone/)
    const next = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: edge })
    expect(await next.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
    expect(inits.map((i) => [i.headers?.Range ?? null, i.priority, i.cache])).toEqual([[null, 'low', 'no-store'], [`bytes=${CUT}-`, 'low', 'no-store']])
  })
})

describe('M7 (review of #2537 head 107dea1ee1, P-5): the record names the client code that failed the pack', () => {
  // The worker passes its own chunk's path (deviceStore.worker.js; the name carries the bundle's content hash), so a
  // deploy that changes the engine is a new client: "never again for this build" (which can last a weekend, when no
  // build lands) does not hold a FIXED client to a broken one's failures. A client that cannot name its code ('') keeps
  // the rule as it was.
  const A = '/assets/deviceStore.worker-AAAA1111.js'
  const B = '/assets/deviceStore.worker-BBBB2222.js'

  it('"never again" holds for the same client across page loads; a new client tries the build again and counts afresh', async () => {
    const good = packOf(UNIVERSE)
    const disk = new Map()
    let t = T0
    const edge = fakeEdge({ u: good })
    const lying = { ...entryOf('D', 'u', good), sha256: 'f'.repeat(64) }
    const eng = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge, codeId: A })
    for (const wait of [0, HOUR, 6 * HOUR]) { t += wait; await expect(eng.ingest(lying)).rejects.toThrow(/sha256/) }
    expect(edge).toHaveBeenCalledTimes(3)
    const same = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge, codeId: A })   // the next page load
    expect(await same.ingest(lying)).toMatchObject({ status: 'backoff', tries: 3, until: null })
    expect(edge).toHaveBeenCalledTimes(3)
    const fixed = createDeviceEngine({ now: () => t, io: memoryIO(disk), fetchFn: edge, codeId: B })  // a deploy later
    await expect(fixed.ingest(lying)).rejects.toThrow(/sha256/)
    expect(edge).toHaveBeenCalledTimes(4)
    expect(await fixed.ingest(lying)).toMatchObject({ status: 'backoff', tries: 1, until: t + HOUR })
    expect(edge).toHaveBeenCalledTimes(4)
  })

  it('a record written before the code was recorded is tried again once by a client that names its code', async () => {
    const good = packOf(UNIVERSE)
    const disk = new Map()
    const lying = { ...entryOf('D', 'u', good), sha256: 'f'.repeat(64) }
    const old = createDeviceEngine({ now: () => T0, io: memoryIO(disk), fetchFn: fakeEdge({ u: good }) })   // names no code
    await expect(old.ingest(lying)).rejects.toThrow(/sha256/)
    const edge = fakeEdge({ u: good })
    const at = T0 + HOUR - 1
    const unnamed = createDeviceEngine({ now: () => at, io: memoryIO(disk), fetchFn: edge })
    expect(await unnamed.ingest(lying)).toMatchObject({ status: 'backoff', tries: 1, until: T0 + HOUR })   // CONTROL: as before
    expect(edge).not.toHaveBeenCalled()
    const named = createDeviceEngine({ now: () => at, io: memoryIO(disk), fetchFn: edge, codeId: A })
    await expect(named.ingest(lying)).rejects.toThrow(/sha256/)
    expect(edge).toHaveBeenCalledTimes(1)
  })
})

describe('M2 serves(): is the held seed still usable today (the split guard, for any symbol)', () => {
  it('the as-of day; the next session only with its split list; never two sessions on; nothing held: no', async () => {
    let t = T0                                                     // Wed 2026-11-18, the as-of day
    const pack = packOf(UNIVERSE)
    const eng = createDeviceEngine({ now: () => t, io: memoryIO(), fetchFn: fakeEdge({ u: pack }) })
    await eng.open()
    expect(eng.serves()).toBe(false)
    await eng.ingest(entryOf('D', 'u', pack))
    expect(eng.serves()).toBe(true)
    t = Date.UTC(2026, 10, 19, 17, 0)                              // Thu 12:00 ET, the next session
    expect(eng.serves()).toBe(false)                               // no split list for it: refused (fail closed)
    expect(eng.read('AAPL', 'D')).toBeNull()
    await eng.setSplits({ splits: { session: '2026-11-19', symbols: { NVDA: 1 } } })
    expect(eng.serves()).toBe(true)                                // a list naming one symbol: the others serve
    expect(eng.read('AAPL', 'D')).not.toBeNull()
    t = Date.UTC(2026, 10, 20, 17, 0)                              // Fri: two sessions on
    expect(eng.serves()).toBe(false)
    expect(eng.read('AAPL', 'D')).toBeNull()
  })
})
