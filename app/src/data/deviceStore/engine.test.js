// @vitest-environment node
// The device store's core against the in-memory disk: the index, exact reads, W/M from D, and the
// ingest (download → sha256 → atomic commit; resume; a wrong file never replaces a good one).
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

/** A D pack (or `tf`) whose trailer names build `b1` unless told otherwise (the entries below say b1). */
const packOf = (syms, o = {}) => seedPackOf(syms, { build: 'b1', ...o })
import { resampleDailyToWeekly, resampleDailyToMonthly } from '../../utils/resampleBars'

const sha = (b) => createHash('sha256').update(b).digest('hex')
/** 18:00 ET on the packs' as-of day (seedPackOf's default, 2026-11-18): the seed's own basis holds. */
const AT_ASOF = () => Date.UTC(2026, 10, 18, 23, 0)
const DAY = 86400
const D0 = Date.UTC(2025, 0, 6) / 1000          // a Monday
/** n weekday sessions from D0, t = 00:00 UTC of the session date (the store's D rule). */
function dailyRows(n, seed = 1) {
  const days = []
  for (let t = D0; days.length < n; t += DAY) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(t) }
  const base = synthBars(n, { seed })
  return base.map((r, i) => ({ ...r, t: days[i] }))
}
const UNIVERSE = { AAPL: dailyRows(350, 1), 'BRK-B': dailyRows(350, 2), MSFT: dailyRows(120, 3) }

/** A fetch serving `files` (url → bytes): Range-aware, optionally cutting the body after `cutAt` bytes. */
function fakeEdge(files, { cutAt = null, ignoreRange = false } = {}) {
  const calls = []
  const fetchFn = vi.fn(async (url, init = {}) => {
    calls.push({ url, range: init.headers?.Range ?? null })
    const bytes = files[url]
    if (!bytes) return new Response('nope', { status: 404 })
    const m = /bytes=(\d+)-/.exec(init.headers?.Range || '')
    const start = m && !ignoreRange ? Number(m[1]) : 0
    const part = bytes.subarray(start)
    const cut = cutAt
    cutAt = null   // one cut only
    // delivered chunk by chunk (a pull per read), like a network body; a cut errors AFTER its bytes
    const chunks = []
    const upto = cut != null && cut < part.length ? cut : part.length
    for (let i = 0; i < upto; i += 4096) chunks.push(part.slice(i, Math.min(upto, i + 4096)))
    const body = new ReadableStream({
      pull(ctl) {
        if (chunks.length) ctl.enqueue(chunks.shift())
        else if (upto < part.length) ctl.error(new Error('network gone'))
        else ctl.close()
      },
    })
    return new Response(body, start ? { status: 206, headers: { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } } : { status: 200 })
  })
  fetchFn.calls = calls
  return fetchFn
}
const entryOf = (tf, url, bytes, build = 'b1') => ({ tf, url, bytes: bytes.length, sha256: sha(bytes), build })
/** The store's pack files on `disk` (a failure record beside them, engine INGEST_STATE_FILE, is not a pack file). */
const packFiles = (disk) => [...disk.keys()].filter((n) => /\.(pack|ok|prog)$/.test(n)).sort()

describe('device engine: index + reads', () => {
  it('reads every symbol back with EXACT values after an ingest; unknown symbol / tf → null', async () => {
    const pack = packOf(UNIVERSE, { tf: 'D' })
    const io = memoryIO()
    const eng = createDeviceEngine({ now: AT_ASOF, io, fetchFn: fakeEdge({ '/seed/D-b1.pack': pack }) })
    await eng.open()
    expect(await eng.ingest(entryOf('D', '/seed/D-b1.pack', pack))).toMatchObject({ tf: 'D', status: 'ingested', count: 3 })
    for (const [sym, rows] of Object.entries(UNIVERSE)) {
      const c = eng.read(sym, 'D')
      expect(c.t.length).toBe(rows.length)
      rows.forEach((r, i) => { expect([c.t[i], c.o[i], c.h[i], c.l[i], c.c[i], c.v[i]]).toEqual([r.t, r.o, r.h, r.l, r.c, r.v]) })
    }
    expect(eng.read('brk-b', 'D').t.length).toBe(350)       // case-insensitive
    expect(eng.read('NOPE', 'D')).toBeNull()
    expect(eng.read('AAPL', '5')).toBeNull()                 // tf not ingested
    expect(eng.info().tfs.D).toMatchObject({ build: 'b1', count: 3 })
  })

  it('finds a class share under either spelling (file "BRK.B", app "BRK-B")', async () => {
    const pack = packOf({ 'BRK.B': dailyRows(30, 9) })
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(), fetchFn: fakeEdge({ u: pack }) })
    await eng.ingest(entryOf('D', 'u', pack))
    expect(eng.read('BRK-B', 'D')?.t.length).toBe(30)
  })

  it('W and M are derived from D with the app\'s resampler, the oldest (partial) bucket dropped', async () => {
    const pack = packOf(UNIVERSE)
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(), fetchFn: fakeEdge({ u: pack }) })
    await eng.ingest(entryOf('D', 'u', pack))
    const rows = UNIVERSE.AAPL.map((r) => ({ ...r, t: new Date(r.t * 1000).toISOString().slice(0, 10) }))
    for (const [tf, fn] of [['W', resampleDailyToWeekly], ['M', resampleDailyToMonthly]]) {
      const want = fn(rows).slice(1)
      const got = eng.read('AAPL', tf)
      expect(got.t.length).toBe(want.length)
      want.forEach((b, i) => {
        expect(new Date(got.t[i] * 1000).toISOString().slice(0, 10)).toBe(b.t)
        expect([got.o[i], got.h[i], got.l[i], got.c[i], got.v[i]]).toEqual([b.o, b.h, b.l, b.c, b.v])
      })
    }
  })

  it('a corrupt record reads null (counted), never throws', async () => {
    const pack = packOf({ AAA: dailyRows(40, 4) })
    const io = memoryIO()
    const eng = createDeviceEngine({ now: AT_ASOF, io, fetchFn: fakeEdge({ u: pack }) })
    await eng.ingest(entryOf('D', 'u', pack))
    const f = [...io.files.entries()].find(([n]) => n.endsWith('.pack'))[1]
    f.buf[20] ^= 0xff                                          // inside AAA's header
    expect(eng.read('AAA', 'D')).toBeNull()
    expect(eng.info().tfs.D.bad).toBe(1)
  })
})

describe('device engine: ingest', () => {
  it('commits atomically and survives a reopen (a new engine over the same disk reads the same values)', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const a = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: fakeEdge({ u: pack }) })
    await a.ingest(entryOf('D', 'u', pack))
    a.close()
    const names = [...disk.keys()].sort()
    expect(names).toEqual(['D.1.ok', 'D.1.pack'])            // no .prog left; marker beside the file
    const b = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: vi.fn() })
    await b.open()
    expect(Array.from(b.read('MSFT', 'D').c)).toEqual(UNIVERSE.MSFT.map((r) => r.c))
  })

  it('a file whose sha256 does not match is discarded, and the committed one keeps serving', async () => {
    const good = packOf(UNIVERSE, { build: 'b1' })
    const next = packOf({ AAPL: dailyRows(350, 77) }, { build: 'b2' })
    const disk = new Map()
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: fakeEdge({ u1: good, u2: next }) })
    await eng.ingest(entryOf('D', 'u1', good))
    const before = Array.from(eng.read('AAPL', 'D').c)
    const wrong = { ...entryOf('D', 'u2', next, 'b2'), sha256: sha(good) }   // a lying manifest
    await expect(eng.ingest(wrong)).rejects.toThrow(/sha256/)
    expect(Array.from(eng.read('AAPL', 'D').c)).toEqual(before)
    expect(eng.info().tfs.D.build).toBe('b1')
    expect(packFiles(disk)).toEqual(['D.1.ok', 'D.1.pack'])   // the bad generation is gone (its failure is recorded: M7)
  })

  it('a new build replaces the old one: new values served, old generation deleted', async () => {
    const one = packOf(UNIVERSE)
    const two = packOf({ AAPL: dailyRows(350, 42) }, { build: 'b2' })
    const disk = new Map()
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: fakeEdge({ u1: one, u2: two }) })
    const events = []
    const e2 = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: fakeEdge({ u1: one, u2: two }), onEvent: (e) => events.push(e) })
    await eng.ingest(entryOf('D', 'u1', one))
    eng.close()
    await e2.open()
    expect(await e2.ingest(entryOf('D', 'u1', one))).toMatchObject({ status: 'current' })   // same build: no download
    await e2.ingest(entryOf('D', 'u2', two, 'b2'))
    expect(Array.from(e2.read('AAPL', 'D').c)).toEqual(dailyRows(350, 42).map((r) => r.c))
    expect(e2.read('MSFT', 'D')).toBeNull()
    expect([...disk.keys()].sort()).toEqual(['D.2.ok', 'D.2.pack'])
    expect(events).toEqual([{ type: 'gen', tf: 'D', build: 'b2', gen: 2 }])
  })

  it('an interrupted download RESUMES from the bytes on disk (Range), re-hashing them', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const edge = fakeEdge({ u: pack }, { cutAt: 5000 })
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: edge })
    await expect(eng.ingest(entryOf('D', 'u', pack))).rejects.toThrow()
    expect(disk.get('D.1.pack').size).toBe(5000)            // the partial stays
    expect(disk.has('D.1.ok')).toBe(false)                  // ...uncommitted
    expect(eng.read('AAPL', 'D')).toBeNull()
    // the page reloads: a NEW engine over the same disk resumes the same build
    const again = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: edge })
    expect(await again.ingest(entryOf('D', 'u', pack))).toMatchObject({ status: 'ingested' })
    expect(edge.calls.map((c) => c.range)).toEqual([null, 'bytes=5000-'])
    expect(Array.from(again.read('AAPL', 'D').h)).toEqual(UNIVERSE.AAPL.map((r) => r.h))
  })

  it('a server that ignores the Range (200) restarts the file from zero, still verified', async () => {
    const pack = packOf(UNIVERSE)
    const disk = new Map()
    const first = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: fakeEdge({ u: pack }, { cutAt: 3000 }) })
    await expect(first.ingest(entryOf('D', 'u', pack))).rejects.toThrow()
    const edge = fakeEdge({ u: pack }, { ignoreRange: true })
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: edge })
    await eng.ingest(entryOf('D', 'u', pack))
    expect(eng.read('MSFT', 'D').t.length).toBe(120)
  })

  it('ingestAll runs the manifest one timeframe at a time, D first, resolving URLs against the manifest', async () => {
    const d = packOf(UNIVERSE, { build: 'b9' })
    // (ending at the as-of session's last bucket, 15:55 ET on 2026-11-18: a seed that stops earlier loses its last row)
    const m5 = packOf({ AAPL: synthBars(300, { step: 300, t0: Date.UTC(2026, 10, 18, 20, 55) / 1000 - 299 * 300 }) }, { tf: '5', build: 'b9' })
    const edge = fakeEdge({ 'https://x.test/seed/D.pack': d, 'https://x.test/seed/5.pack': m5 })
    let inFlight = 0, peak = 0
    const counting = vi.fn(async (...a) => { inFlight++; peak = Math.max(peak, inFlight); try { return await edge(...a) } finally { inFlight-- } })
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(), fetchFn: counting })
    const out = await eng.ingestAll({ v: 1, build: 'b9', tfs: {
      '5': { url: '5.pack', bytes: m5.length, sha256: sha(m5) },
      D: { url: 'D.pack', bytes: d.length, sha256: sha(d) },
    } }, { base: 'https://x.test/seed/manifest.json' })
    expect(out.map((r) => [r.tf, r.status])).toEqual([['D', 'ingested'], ['5', 'ingested']])
    expect(edge.calls.map((c) => c.url)).toEqual(['https://x.test/seed/D.pack', 'https://x.test/seed/5.pack'])
    expect(peak).toBe(1)
    expect(eng.read('AAPL', '5').t.length).toBe(300)
    expect(eng.info().tfs['5'].build).toBe('b9')
  })

  it('a file holding another build than the manifest names is never committed (a stale edge copy)', async () => {
    const pack = packOf(UNIVERSE, { build: '20261118T0131Z' })
    const disk = new Map()
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: fakeEdge({ u: pack }) })
    await expect(eng.ingest(entryOf('D', 'u', pack, '20261119T0131Z'))).rejects.toThrow(/build/)
    expect(eng.read('AAPL', 'D')).toBeNull()
    expect(packFiles(disk)).toEqual([])                      // discarded whole: nothing to resume into a loop
  })

  it('refuses a malformed manifest entry before touching the disk', async () => {
    const disk = new Map()
    const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(disk), fetchFn: vi.fn() })
    await expect(eng.ingest({ tf: 'D', url: 'u', bytes: 100, sha256: 'x', build: 'b' })).rejects.toThrow(/manifest/)
    await expect(eng.ingest({ tf: '60e', url: 'u', bytes: 100, sha256: 'a'.repeat(64), build: 'b' })).rejects.toThrow(/manifest/)
    expect(disk.size).toBe(0)
  })
})
