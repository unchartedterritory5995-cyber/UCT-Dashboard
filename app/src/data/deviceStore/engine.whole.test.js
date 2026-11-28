// @vitest-environment node
// THE FULL-DEPTH DAILY PACK ON THE DEVICE (zero-network PR 3.1; codec.wholeOf / isWhole). The server's trailer says
// `whole: true` (every symbol's window is its WHOLE served series) except the symbols in `partial`. The engine's read
// carries `whole` on such a copy, so the bar store knows nothing older exists (no deep history join, PR 3.2). A
// malformed key refuses the file (never painted); a pack without the key is whole nowhere; the daily DELTA (built by the
// SERVER, __fixtures__/ffseed_delta.json case `Dwhole`) rebuilds a pack whose trailer says what the full pack says.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import FIX from './__fixtures__/ffseed_delta.json'
import { createDeviceEngine } from './engine'
import { createDeviceClient, SYNC_CACHE_MAX_BYTES } from './client'
import { memoryIO } from './io'
import { parseTrailer, trailerLengthOf, PACK_TAIL_BYTES, isWhole, DeviceFormatError } from './codec'
import { seedPackOf, synthBars } from './testing/fixtures'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const DAY = 86400
const D0 = Date.UTC(2025, 0, 6) / 1000
const daily = (n, seed) => synthBars(n, { seed }).map((r, i) => ({ ...r, t: D0 + i * DAY }))
/** 18:00 ET on the packs' as-of day (seedPackOf's default 2026-11-18): the seed's own basis holds. */
const AT_ASOF = () => Date.UTC(2026, 10, 18, 23, 0)

function indexOf(pack, tf = 'D') {
  const tlen = trailerLengthOf(pack.subarray(pack.length - PACK_TAIL_BYTES), pack.length)
  const dataEnd = pack.length - PACK_TAIL_BYTES - tlen
  return parseTrailer(pack.subarray(dataEnd, dataEnd + tlen), dataEnd, { tf })
}

async function holding(pack, { build = '20261119T0131Z' } = {}) {
  const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(new Map()), fetchFn: async () => new Response(pack) })
  const r = await eng.ingest({ tf: 'D', url: 'https://x.test/D.ffs', bytes: pack.length, sha256: sha(pack), build })
  return { eng, r }
}

describe('codec: the whole / partial trailer keys', () => {
  it('whole: every symbol but the partial ones; no key: nothing is whole', () => {
    const rows = { AAA: daily(30, 1), BBB: daily(40, 2) }
    const idx = indexOf(seedPackOf(rows, { whole: { partial: ['BBB'] } }))
    expect(idx.whole).toBe(true)
    expect([...idx.partial]).toEqual(['BBB'])
    expect(isWhole(idx, 'AAA')).toBe(true)
    expect(isWhole(idx, 'BBB')).toBe(false)
    const plain = indexOf(seedPackOf(rows))
    expect(plain.whole).toBe(false)
    expect(isWhole(plain, 'AAA')).toBe(false)
  })

  it('a malformed whole key refuses the file, and the engine never swaps such a pack in', async () => {
    const rows = { AAA: daily(30, 1) }
    const good = seedPackOf(rows, { whole: { partial: [] } })
    // the trailer re-written with `partial` a string (a server bug or a corrupt edge object with a matching sha256)
    const tlen = trailerLengthOf(good.subarray(good.length - PACK_TAIL_BYTES), good.length)
    const dataEnd = good.length - PACK_TAIL_BYTES - tlen
    const tr = JSON.parse(new TextDecoder().decode(good.subarray(dataEnd, dataEnd + tlen)))
    tr.partial = 'AAA'
    const t = new TextEncoder().encode(JSON.stringify(tr))
    const bad = new Uint8Array(dataEnd + t.length + PACK_TAIL_BYTES)
    bad.set(good.subarray(0, dataEnd), 0)
    bad.set(t, dataEnd)
    new DataView(bad.buffer).setUint32(dataEnd + t.length, t.length, true)
    bad.set(good.subarray(good.length - 8), dataEnd + t.length + 8)
    expect(() => indexOf(bad)).toThrow(DeviceFormatError)
    const { eng, r } = await holding(bad).catch((e) => ({ r: { error: e } }))
    expect(r.error).toBeTruthy()
    if (eng) expect(eng.read('AAA', 'D')).toBeNull()
  })
})

describe('engine: a read of a whole copy says so', () => {
  it('whole symbol: `whole` true and its first row is the series first; partial or a plain pack: no flag', async () => {
    const rows = { AAA: daily(30, 1), BBB: daily(40, 2) }
    const { eng } = await holding(seedPackOf(rows, { whole: { partial: ['BBB'] } }))
    const a = eng.read('AAA', 'D')
    expect(a.whole).toBe(true)
    expect(a.t[0]).toBe(rows.AAA[0].t)
    expect(eng.read('BBB', 'D').whole).toBeUndefined()
    expect(eng.info().tfs.D).toMatchObject({ whole: true, partial: 1 })
    const { eng: plain } = await holding(seedPackOf(rows))
    expect(plain.read('AAA', 'D').whole).toBeUndefined()
  })
})

describe('engine: the full-depth daily delta (the server\'s, fixture case Dwhole)', () => {
  const C = FIX.cases.Dwhole
  const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
  const NOW = () => Date.UTC(2026, 10, 19, 23, 0)
  const ORIGIN = 'https://x.test'
  const base = bytesOf(C.base), next = bytesOf(C.new), delta = bytesOf(C.delta)

  it('a held whole pack takes the delta (one appended row a symbol) and the rebuilt pack is whole exactly as the full pack', async () => {
    expect(C.ops).toEqual({ DEEP: 'merge', YNG: 'merge' })
    const files = { [ORIGIN + C.base_entry.url]: base, [ORIGIN + C.entry.url]: next, [ORIGIN + C.entry.delta.url]: delta }
    const calls = []
    const fetchFn = async (url) => { calls.push(String(url)); return files[String(url)] ? new Response(files[String(url)]) : new Response('no', { status: 404 }) }
    const eng = createDeviceEngine({ now: NOW, io: memoryIO(new Map()), fetchFn })
    await eng.ingest({ tf: 'D', build: FIX.base_build, url: ORIGIN + C.base_entry.url, bytes: base.length, sha256: sha(base) })
    calls.length = 0
    const r = await eng.ingest({ tf: 'D', build: FIX.build, ...C.entry, url: ORIGIN + C.entry.url, delta: { ...C.entry.delta, url: ORIGIN + C.entry.delta.url } })
    expect(r).toMatchObject({ status: 'ingested', via: 'delta' })
    expect(calls).toEqual([ORIGIN + C.entry.delta.url])          // the delta only, never the full pack
    const full = indexOf(next)
    expect(eng.info().tfs.D).toMatchObject({ via: 'delta', whole: true, partial: 1 })
    const y = eng.read('YNG', 'D')
    expect(y.whole).toBe(true)
    expect(y.t.length).toBe(full.bars[full.row.get('YNG')])     // the window GREW by a session (41 rows)
    expect(eng.read('DEEP', 'D').whole).toBeUndefined()
  })
})

describe('client: the synchronous cache is bounded by bytes too (SYNC_CACHE_MAX_BYTES)', () => {
  it('32 MiB; a full-depth copy evicts the least recently read once the bytes pass it, the newest always stays', async () => {
    expect(SYNC_CACHE_MAX_BYTES).toBe(32 * 1024 * 1024)
    const cols = (n) => Object.fromEntries(['t', 'o', 'h', 'l', 'c', 'v'].map((k) => [k, new Float64Array(n)]))
    const answers = { AAA: cols(1000), BBB: cols(1000), CCC: cols(4000) }   // 48 KB, 48 KB, 192 KB
    const w = { onmessage: null, onerror: null, terminate() {} }
    w.postMessage = (m) => queueMicrotask(() => w.onmessage({ data: { id: m.id, ok: true, res: m.op === 'read' ? answers[m.sym] : null } }))
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, cacheMaxBytes: 250_000 })
    await c.getBars('AAA', 'D')
    await c.getBars('BBB', 'D')
    expect(c.cacheBytes()).toBe(96_000)
    await c.getBars('CCC', 'D')                                  // 288 KB > 250 KB: AAA goes (BBB + CCC = 240 KB)
    expect(c.peekBars('AAA', 'D')).toBeNull()
    expect(c.peekBars('BBB', 'D')).not.toBeNull()
    expect(c.cacheBytes()).toBe(240_000)
    const big = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, cacheMaxBytes: 10 })
    await big.getBars('CCC', 'D')
    expect(big.peekBars('CCC', 'D')).not.toBeNull()              // the newest copy stays, whatever its size
  })
})
