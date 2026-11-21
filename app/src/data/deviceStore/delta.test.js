// @vitest-environment node
// The daily DELTA on the device (UFFSDLT1, docs/charts/first-frame-seed-format.md section 10), against deltas
// the SERVER built: __fixtures__/ffseed_delta.json is written by tools/ffseed_make_delta_js_fixture.py from
// api/services/ffseed_format.py + ffseed_delta.py (`build_delta`, which proves each delta with the reference
// applier before returning it). Synthetic bars. Every case ends in one of two states: the device holds the
// new build, read back value for value as the server's FULL pack reads, or it fell back to that full pack.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import FIX from './__fixtures__/ffseed_delta.json'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { trailerLengthOf, parseTrailer, decodeRecord, PACK_TAIL_BYTES } from './codec'
import { parseDelta, applyDelta, OP } from './delta'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
/** 18:00 ET on the base's as-of day: both builds' basis holds (the split guard needs no list). */
const NOW = () => Date.UTC(2026, 10, 19, 23, 0)
const ORIGIN = 'https://x.test'

function indexOf(pack, tf) {
  const tlen = trailerLengthOf(pack.subarray(pack.length - PACK_TAIL_BYTES), pack.length)
  const dataEnd = pack.length - PACK_TAIL_BYTES - tlen
  return parseTrailer(pack.subarray(dataEnd, dataEnd + tlen), dataEnd, { tf })
}
/** Every symbol of a pack, decoded by the reader: sym → {t,o,h,l,c,v} as plain arrays. */
function readAll(pack, tf) {
  const index = indexOf(pack, tf)
  const out = {}
  for (const [sym, i] of index.row) {
    const c = decodeRecord(index, i, pack.slice(index.off[i], index.off[i] + index.len[i]))
    out[sym] = Object.fromEntries(['t', 'o', 'h', 'l', 'c', 'v'].map((k) => [k, Array.from(c[k])]))
  }
  return out
}
const colsOf = (c) => (c ? Object.fromEntries(['t', 'o', 'h', 'l', 'c', 'v'].map((k) => [k, Array.from(c[k])])) : null)

/** Rebuild `pack` with its trailer edited by `fn` (the blobs unchanged). */
function withTrailer(pack, fn) {
  const tlen = trailerLengthOf(pack.subarray(pack.length - PACK_TAIL_BYTES), pack.length)
  const dataEnd = pack.length - PACK_TAIL_BYTES - tlen
  const tr = JSON.parse(new TextDecoder().decode(pack.subarray(dataEnd, dataEnd + tlen)))
  fn(tr)
  const t = new TextEncoder().encode(JSON.stringify(tr))
  const out = new Uint8Array(dataEnd + t.length + 16)
  out.set(pack.subarray(0, dataEnd), 0)
  out.set(t, dataEnd)
  new DataView(out.buffer).setUint32(dataEnd + t.length, t.length, true)
  out.set(pack.subarray(pack.length - 8), dataEnd + t.length + 8)
  return out
}

/** A fetch serving `files` (url → bytes), chunk by chunk; `cut[url]` = deliver that many bytes, then fail. */
function fakeEdge(files, { cut = {} } = {}) {
  const calls = []
  const fetchFn = vi.fn(async (url) => {
    calls.push(url)
    const bytes = files[url]
    if (!bytes) return new Response('nope', { status: 404 })
    const upto = cut[url] ?? bytes.length
    const chunks = []
    for (let i = 0; i < upto; i += 4096) chunks.push(bytes.slice(i, Math.min(upto, i + 4096)))
    const body = new ReadableStream({
      pull(ctl) {
        if (chunks.length) ctl.enqueue(chunks.shift())
        else if (upto < bytes.length) ctl.error(new Error('network gone'))
        else ctl.close()
      },
    })
    return new Response(body, { status: 200 })
  })
  fetchFn.calls = calls
  return fetchFn
}

/** One fixture case, with absolute URLs and the two nights' manifest entries. */
function caseOf(tf) {
  const C = FIX.cases[tf]
  const base = bytesOf(C.base), next = bytesOf(C.new), delta = bytesOf(C.delta)
  const abs = (u) => ORIGIN + u
  const baseEntry = { tf, build: FIX.base_build, url: abs(C.base_entry.url), bytes: base.length, sha256: sha(base) }
  const newEntry = { tf, build: FIX.build, ...C.entry, url: abs(C.entry.url), delta: { ...C.entry.delta, url: abs(C.entry.delta.url) } }
  const files = { [baseEntry.url]: base, [newEntry.url]: next, [newEntry.delta.url]: delta }
  return { C, base, next, delta, baseEntry, newEntry, files }
}

/** An engine holding the base build of `tf` (night 1, a full download). */
async function holdingBase(tf, { disk = new Map(), files = null, io = null, ...o } = {}) {
  const k = caseOf(tf)
  const edge = fakeEdge(files ?? k.files)
  const eng = createDeviceEngine({ now: NOW, io: io ?? memoryIO(disk), fetchFn: edge, ...o })
  expect(await eng.ingest(k.baseEntry)).toMatchObject({ status: 'ingested', via: 'full' })
  edge.calls.length = 0
  return { ...k, eng, edge, disk }
}
/** Rebuild a DELTA with its trailer edited by `fn` (the blobs unchanged, so every offset still holds). */
function withDeltaTrailer(delta, fn) {
  const n = delta.length
  const tlen = new DataView(delta.buffer, delta.byteOffset + n - 16, 8).getUint32(0, true)
  const dataEnd = n - 16 - tlen
  const tr = JSON.parse(new TextDecoder().decode(delta.subarray(dataEnd, dataEnd + tlen)))
  fn(tr)
  const t = new TextEncoder().encode(JSON.stringify(tr))
  const out = new Uint8Array(dataEnd + t.length + 16)
  out.set(delta.subarray(0, dataEnd), 0)
  out.set(t, dataEnd)
  new DataView(out.buffer).setUint32(dataEnd + t.length, t.length, true)
  out.set(delta.subarray(n - 8), dataEnd + t.length + 8)
  return out
}
/** night 2 against a delta whose bytes are `bad` (the manifest naming exactly those bytes), counts left out */
async function night2With(bad, { counts = false } = {}) {
  const k = caseOf('5')
  const { symbols, bars, ...noCounts } = k.newEntry
  const entry = { ...(counts ? k.newEntry : noCounts), delta: { ...k.newEntry.delta, bytes: bad.length, sha256: sha(bad) } }
  const { eng, edge } = await holdingBase('5', { files: { ...k.files, [k.newEntry.delta.url]: bad } })
  return { r: await eng.ingest(entry), eng, edge, k, symbols, bars }
}
const cloneDisk = (disk) => new Map([...disk].map(([k, f]) => [k, { buf: f.buf.slice(0, f.size), size: f.size, open: false }]))
const filesOn = (disk) => [...disk.keys()].sort()

describe('the fixture is the server\'s, and covers every operation', () => {
  it('5m: keep (unchanged and trimmed), merge (slide, revision, scale up, scale down), replace (split, hole, new), remove', () => {
    expect(FIX.cases['5'].ops).toEqual({ APP: 'merge', REV: 'merge', SAME: 'keep', TRIM: 'keep', SPLIT: 'replace', HOLE: 'replace',
      UP: 'merge', DOWN: 'merge', GONE: 'remove', NEWSYM: 'replace' })
    expect(FIX.cases['5'].splits.symbols).toEqual({ SPLIT: 2.0 })
    expect(FIX.cases.D).toMatchObject({ comp: 'raw', ops: { AAA: 'merge', 'BRK-B': 'merge' } })
    const d = parseDelta(bytesOf(FIX.cases['5'].delta), { tf: '5' })
    expect([d.base, d.build, d.tf, d.comp]).toEqual([FIX.base_build, FIX.build, '5', 'gzip'])
  })
})

describe('delta.js: applying the server\'s delta to the server\'s base', () => {
  for (const tf of ['5', 'D']) {
    it(`${tf}: every record the applier computes decodes to the new FULL pack's bars, and the symbol set is the new build's`, () => {
      const { base, next, delta } = caseOf(tf)
      const bi = indexOf(base, tf)
      const want = readAll(next, tf)
      const ni = indexOf(next, tf)
      const got = {}
      for (const { sym, blob, entry } of applyDelta({ index: bi, read: (i) => base.slice(bi.off[i], bi.off[i] + bi.len[i]) }, parseDelta(delta, { tf }), delta)) {
        // a one-record index for this record, as the device's trailer states it
        const one = { ...bi, comp: bi.comp, count: 1, row: new Map([[sym, 0]]) }
        ;['off', 'len', 'bars', 'first', 'last', 'asof', 'crc', 'body', 'pscale', 'vscale'].forEach((f, k) => { one[f] = Float64Array.of(entry[k]) })
        one.off[0] = 0
        got[sym] = colsOf(decodeRecord(one, 0, blob))
        // the entry is the server's full-pack entry, but for where the blob sits and how it is compressed
        const j = ni.row.get(sym)
        expect([entry[2], entry[3], entry[4], entry[5], entry[6], entry[8], entry[9]])
          .toEqual([ni.bars[j], ni.first[j], ni.last[j], ni.asof[j], ni.crc[j], ni.pscale[j], ni.vscale[j]])
      }
      expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
      expect(got).toEqual(want)
    })
  }

  it('an unchanged symbol reuses its base blob byte for byte; a split symbol carries the NEW basis, never base rows', () => {
    const { base, next, delta } = caseOf('5')
    const bi = indexOf(base, '5')
    const out = {}
    for (const r of applyDelta({ index: bi, read: (i) => base.slice(bi.off[i], bi.off[i] + bi.len[i]) }, parseDelta(delta, { tf: '5' }), delta)) out[r.sym] = r
    const i = bi.row.get('SAME')
    expect(Array.from(out.SAME.blob)).toEqual(Array.from(base.subarray(bi.off[i], bi.off[i] + bi.len[i])))
    const was = readAll(base, '5').SPLIT, now = readAll(next, '5').SPLIT
    const t = now.t[0]
    expect(was.t).toContain(t)                                       // the same bar on both nights...
    expect(now.c[0]).toBeCloseTo(was.c[was.t.indexOf(t)] / 2, 3)     // ...halved on the new basis
    expect(parseDelta(delta, { tf: '5' }).symbols.get('SPLIT')[0]).toBe(OP.replace)
  })
})

describe('engine: the delta path', () => {
  for (const tf of ['5', 'D']) {
    it(`${tf}: night 2 downloads ONLY the delta, and the device then reads exactly what the full pack holds`, async () => {
      const { eng, edge, disk, next, newEntry } = await holdingBase(tf)
      const r = await eng.ingest(newEntry)
      expect(r).toMatchObject({ tf, status: 'ingested', build: FIX.build, via: 'delta', bytes: newEntry.delta.bytes })
      expect(edge.calls).toEqual([newEntry.delta.url])                       // never the pack
      const want = readAll(next, tf)
      for (const [sym, cols] of Object.entries(want)) expect(colsOf(eng.read(sym, tf)), sym).toEqual(cols)
      if (tf === '5') expect(eng.read('GONE', '5')).toBeNull()
      expect(eng.info().tfs[tf]).toMatchObject({ build: FIX.build, gen: 2, via: 'delta', count: Object.keys(want).length })
      expect(filesOn(disk)).toEqual([`${tf}.2.ok`, `${tf}.2.pack`])         // the base generation is gone, no .prog
      // the rebuilt trailer states every symbol exactly as the server's full pack does (where its blob sits aside)
      const mine = indexOf(disk.get(`${tf}.2.pack`).buf.slice(0, disk.get(`${tf}.2.pack`).size), tf)
      const theirs = indexOf(next, tf)
      for (const [sym, j] of theirs.row) {
        const i = mine.row.get(sym)
        for (const f of ['bars', 'first', 'last', 'asof', 'crc', 'body', 'pscale', 'vscale']) expect(mine[f][i], `${sym} ${f}`).toBe(theirs[f][j])
      }
      // a reload: the committed generation opens, and the same manifest is CURRENT (nothing fetched again)
      eng.close()
      const again = createDeviceEngine({ now: NOW, io: memoryIO(disk), fetchFn: edge })
      await again.open()
      expect(await again.ingest(newEntry)).toMatchObject({ status: 'current', via: 'delta' })
      expect(edge.calls).toEqual([newEntry.delta.url])
      expect(colsOf(again.read(Object.keys(want)[0], tf))).toEqual(want[Object.keys(want)[0]])
    })
  }

  it('ingestAll, two nights: the delta URL resolves against the manifest like the pack\'s', async () => {
    const { files, C, base } = caseOf('5')
    const edge = fakeEdge(files)
    const eng = createDeviceEngine({ now: NOW, io: memoryIO(), fetchFn: edge })
    const manifest = 'https://x.test/api/seed/v1/latest.json'
    const night1 = { v: 1, kind: 'ffseed', build: FIX.base_build, tfs: { 5: { ...C.base_entry, bytes: base.length } } }
    const night2 = { v: 1, kind: 'ffseed', build: FIX.build, splits: C.splits, tfs: { 5: C.entry } }
    expect((await eng.ingestAll(night1, { base: manifest })).map((r) => [r.status, r.via])).toEqual([['ingested', 'full']])
    expect((await eng.ingestAll(night2, { base: manifest })).map((r) => [r.status, r.via])).toEqual([['ingested', 'delta']])
    expect(edge.calls).toEqual([ORIGIN + C.base_entry.url, ORIGIN + C.entry.delta.url])
  })

  it('a delta for ANOTHER base is never downloaded: the full pack is', async () => {
    const k = caseOf('5')
    const other = withTrailer(k.base, (tr) => { tr.build = '20261119T0131Z' })     // the device missed a night
    const files = { ...k.files, [k.baseEntry.url]: other }
    const edge = fakeEdge(files)
    const eng = createDeviceEngine({ now: NOW, io: memoryIO(), fetchFn: edge })
    await eng.ingest({ ...k.baseEntry, build: '20261119T0131Z', bytes: other.length, sha256: sha(other) })
    edge.calls.length = 0
    expect(await eng.ingest(k.newEntry)).toMatchObject({ status: 'ingested', via: 'full', delta: 'other-base' })
    expect(edge.calls).toEqual([k.newEntry.url])
    expect(colsOf(eng.read('APP', '5'))).toEqual(readAll(k.next, '5').APP)
    // and nothing held at all: the full pack, the delta untouched
    const fresh = fakeEdge(k.files)
    const empty = createDeviceEngine({ now: NOW, io: memoryIO(), fetchFn: fresh })
    expect(await empty.ingest(k.newEntry)).toMatchObject({ via: 'full', delta: 'no-base' })
    expect(fresh.calls).toEqual([k.newEntry.url])
  })

  it('a manifest that LIES about the base (the delta\'s own trailer names another) falls back to the full pack', async () => {
    const k = caseOf('5')
    const other = withTrailer(k.base, (tr) => { tr.build = '20261119T0131Z' })
    const edge = fakeEdge({ ...k.files, [k.baseEntry.url]: other })
    const eng = createDeviceEngine({ now: NOW, io: memoryIO(), fetchFn: edge })
    await eng.ingest({ ...k.baseEntry, build: '20261119T0131Z', bytes: other.length, sha256: sha(other) })
    const lying = { ...k.newEntry, delta: { ...k.newEntry.delta, base: '20261119T0131Z' } }
    const r = await eng.ingest(lying)
    expect(r).toMatchObject({ status: 'ingested', via: 'full' })
    expect(r.delta).toMatch(/failed: delta: 5 applies to 20261120T0131Z, held 20261119T0131Z/)
  })

  it('a manifest whose symbol count is not the delta\'s new set falls back to the full pack before a byte is written', async () => {
    const { eng, disk, newEntry } = await holdingBase('5')
    const r = await eng.ingest({ ...newEntry, symbols: newEntry.symbols + 1 })
    expect(r).toMatchObject({ via: 'full' })
    expect(r.delta).toMatch(/symbols, the manifest says/)
    expect(filesOn(disk)).toEqual(['5.2.ok', '5.2.pack'])
  })

  it('a delta that does not name a held symbol is refused even when the manifest states no counts', async () => {
    const { r, eng, k, symbols, bars } = await night2With(withDeltaTrailer(caseOf('5').delta, (tr) => { delete tr.symbols.APP }))
    expect([symbols > 0, bars > 0]).toEqual([true, true])           // the real manifest has them; this one does not
    expect(r).toMatchObject({ via: 'full' })
    expect(r.delta).toMatch(/no entry for base symbol APP/)
    expect(colsOf(eng.read('APP', '5'))).toEqual(readAll(k.next, '5').APP)
  })

  it('a delta that would leave NOTHING (every symbol removed) is never swapped in over a good copy', async () => {
    const { r } = await night2With(withDeltaTrailer(caseOf('5').delta, (tr) => {
      for (const s of Object.keys(tr.symbols)) tr.symbols[s] = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]
    }))
    expect(r).toMatchObject({ via: 'full' })
    expect(r.delta).toMatch(/an empty build/)
  })

  it('a malformed delta entry, or one no smaller than the pack, is not even fetched; a delta longer than the manifest says is refused', async () => {
    const k = caseOf('5')
    const { eng, edge } = await holdingBase('5')
    expect(await eng.ingest({ ...k.newEntry, delta: { ...k.newEntry.delta, sha256: 'nope' } })).toMatchObject({ via: 'full', delta: 'bad-entry' })
    expect(edge.calls).toEqual([k.newEntry.url])
    const { eng: e3, edge: g3 } = await holdingBase('5')
    expect(await e3.ingest({ ...k.newEntry, delta: { ...k.newEntry.delta, bytes: k.newEntry.bytes } })).toMatchObject({ via: 'full', delta: 'not-smaller' })
    expect(g3.calls).toEqual([k.newEntry.url])
    const { eng: e2 } = await holdingBase('5')
    const r = await e2.ingest({ ...k.newEntry, delta: { ...k.newEntry.delta, bytes: k.delta.length - 100 } })
    expect(r).toMatchObject({ via: 'full' })
    expect(r.delta).toMatch(/longer than the manifest says/)
  })

  it('the reader refuses what a version-1 delta cannot be', () => {
    const d = caseOf('5').delta
    const bad = (fn) => () => parseDelta(withDeltaTrailer(d, fn), { tf: '5' })
    expect(() => parseDelta(d, { tf: 'D' })).toThrow(/holds tf 5, expected D/)
    expect(bad((tr) => { tr.v = 2 })).toThrow(/not an ffseed-delta v1/)
    expect(bad((tr) => { tr.fields = [...tr.fields].reverse() })).toThrow(/unknown entry fields/)
    expect(bad((tr) => { tr.base = tr.build })).toThrow(/build \/ base/)
    expect(bad((tr) => { tr.symbols.APP[0] = 4 })).toThrow(/op 4/)
    expect(bad((tr) => { tr.symbols.APP[2] = 1e9 })).toThrow(/out of range/)
    expect(bad((tr) => { tr.symbols.SPLIT[3] = 1 })).toThrow(/replace holds 1 of/)
    expect(bad((tr) => { tr.symbols.SAME[2] = 5 })).toThrow(/blob/)
    expect(bad((tr) => { tr.symbols.APP[10] = 3 })).toThrow(/window/)
    const pack = caseOf('5').next
    expect(() => parseDelta(pack, { tf: '5' })).toThrow(/not a UFFSDLT1 file/)
  })

  it('a corrupted delta never lands: a flipped byte in transit (sha256), or a server-side wrong value (the column CRC)', async () => {
    // (a) in transit: the bytes are not the ones the manifest names
    {
      const k = caseOf('5')
      const bad = k.delta.slice()
      const [, off, len] = parseDelta(k.delta, { tf: '5' }).symbols.get('APP')
      bad[off + (len >> 1)] ^= 1
      const { eng, next } = await holdingBase('5', { files: { ...k.files, [k.newEntry.delta.url]: bad } })
      const r = await eng.ingest(k.newEntry)
      expect(r).toMatchObject({ status: 'ingested', via: 'full' })
      expect(r.delta).toMatch(/sha256 mismatch/)
      expect(colsOf(eng.read('APP', '5'))).toEqual(readAll(next, '5').APP)
    }
    // (b) a delta whose bytes ARE what the manifest names (a builder bug past its own proof): the D raw merge
    //     blob's last N value 0 -> 1 decodes cleanly and only the applied window's column CRC can refuse it
    {
      const k = caseOf('D')
      const bad = k.delta.slice()
      const [, off, len] = parseDelta(k.delta, { tf: 'D' }).symbols.get('AAA')
      expect(bad[off + len - 1]).toBe(0)
      bad[off + len - 1] = 1
      const files = { ...k.files, [k.newEntry.delta.url]: bad }
      const entry = { ...k.newEntry, delta: { ...k.newEntry.delta, sha256: sha(bad) } }
      const { eng, next, disk } = await holdingBase('D', { files })
      const r = await eng.ingest(entry)
      expect(r).toMatchObject({ status: 'ingested', via: 'full' })
      expect(r.delta).toMatch(/column CRC mismatch/)
      expect(colsOf(eng.read('AAA', 'D'))).toEqual(readAll(next, 'D').AAA)
      expect(filesOn(disk)).toEqual(['D.2.ok', 'D.2.pack'])
      expect(eng.info().tfs.D.via).toBe('full')
    }
    // (c) a delta this reader does not know (a future "UFFSDLT2"), its sha256 matching: a decode error
    {
      const k = caseOf('5')
      const wrong = k.delta.slice()
      wrong[wrong.length - 1] = 0x32
      const files = { ...k.files, [k.newEntry.delta.url]: wrong }
      const entry = { ...k.newEntry, delta: { ...k.newEntry.delta, bytes: wrong.length, sha256: sha(wrong) } }
      const { eng } = await holdingBase('5', { files })
      const r = await eng.ingest(entry)
      expect(r).toMatchObject({ via: 'full' })
      expect(r.delta).toMatch(/not a UFFSDLT1 file/)
    }
  })

  it('a partial delta download (the network drops mid-file) falls back to the full pack, nothing of it left', async () => {
    const k = caseOf('5')
    const { eng, disk } = await holdingBase('5', { files: k.files })
    const edge = fakeEdge(k.files, { cut: { [k.newEntry.delta.url]: 1000 } })
    const e2 = createDeviceEngine({ now: NOW, io: memoryIO(disk), fetchFn: edge })
    eng.close()
    const r = await e2.ingest(k.newEntry)
    expect(r).toMatchObject({ status: 'ingested', via: 'full' })
    expect(r.delta).toMatch(/network gone/)
    expect(edge.calls).toEqual([k.newEntry.delta.url, k.newEntry.url])
    expect(filesOn(disk)).toEqual(['5.2.ok', '5.2.pack'])
  })

  it('the edge without the delta route yet (404) falls back to the full pack', async () => {
    const k = caseOf('5')
    const { eng } = await holdingBase('5', { files: { [k.baseEntry.url]: k.base, [k.newEntry.url]: k.next } })
    expect(await eng.ingest(k.newEntry)).toMatchObject({ via: 'full', delta: 'failed: delta: 5 answered 404' })
  })

  it('while a delta applies, every read is the HELD build; the new one is readable only once committed', async () => {
    const k = caseOf('5')
    const { eng, disk, base } = await holdingBase('5', { deltaSliceMs: 0 })        // yield after every record
    const held = readAll(base, '5')
    const p = eng.ingest(k.newEntry)
    let sawPartial = false
    for (let i = 0; i < 200 && !disk.has('5.2.ok'); i++) {
      await new Promise((r) => setTimeout(r, 0))
      if (disk.has('5.2.pack') && !disk.has('5.2.ok')) {
        sawPartial = true
        expect(eng.info().tfs['5']).toMatchObject({ build: FIX.base_build, gen: 1 })
        expect(colsOf(eng.read('APP', '5'))).toEqual(held.APP)
        expect(colsOf(eng.read('GONE', '5'))).toEqual(held.GONE)
      }
    }
    expect(sawPartial).toBe(true)
    expect(await p).toMatchObject({ via: 'delta' })
    expect(colsOf(eng.read('APP', '5'))).toEqual(readAll(k.next, '5').APP)
  })
})

describe('engine: an interrupted write', () => {
  /** memoryIO whose FIRST handle on `name` throws on its `atWrite`-th write, after snapshotting the disk (what
   *  a tab closed at that instant leaves behind). */
  function crashingIO(disk, name, atWrite) {
    const io = memoryIO(disk)
    const open = io.open.bind(io)
    let armed = true
    io.snapshot = null
    io.open = async (n, o) => {
      const h = await open(n, o)
      if (n !== name || !armed) return h
      armed = false
      let k = 0
      return { ...h, write(u8, at) { if (++k === atWrite) { io.snapshot = cloneDisk(disk); throw new Error('the tab is gone') } return h.write(u8, at) } }
    }
    return io
  }

  it('the held pack keeps serving, the half-written generation is never marked ok, and a reload finishes the job', async () => {
    const k = caseOf('5')
    const disk = new Map()
    const io = crashingIO(disk, '5.2.pack', 3)
    // the full pack is unreachable too, so this run ends with nothing new
    const { eng, base } = await holdingBase('5', { disk, io, files: { [k.baseEntry.url]: k.base, [k.newEntry.delta.url]: k.delta } })
    await expect(eng.ingest(k.newEntry)).rejects.toThrow(/404/)
    const held = readAll(base, '5')
    expect(eng.info().tfs['5']).toMatchObject({ build: FIX.base_build, gen: 1, via: 'full' })
    expect(colsOf(eng.read('APP', '5'))).toEqual(held.APP)
    expect(disk.has('5.2.ok')).toBe(false)
    // the disk as the crash left it: the partial new generation, unmarked, beside the held one
    const crash = io.snapshot
    expect(crash.get('5.2.pack').size).toBeGreaterThan(0)
    expect(filesOn(crash)).toEqual(['5.1.ok', '5.1.pack', '5.2.pack'])
    const reload = createDeviceEngine({ now: NOW, io: memoryIO(crash), fetchFn: fakeEdge(k.files) })
    await reload.open()
    expect(reload.info().tfs['5']).toMatchObject({ build: FIX.base_build, gen: 1 })
    expect(colsOf(reload.read('APP', '5'))).toEqual(held.APP)
    // the next ingest applies the delta again, in a new generation, and sweeps the stray one
    expect(await reload.ingest(k.newEntry)).toMatchObject({ via: 'delta' })
    expect(filesOn(crash)).toEqual(['5.3.ok', '5.3.pack'])
    expect(colsOf(reload.read('APP', '5'))).toEqual(readAll(k.next, '5').APP)
  })

  it('a new file that does not read back as written (the disk kept another byte in its trailer) is never committed', async () => {
    const k = caseOf('5')
    const disk = new Map()
    const io = memoryIO(disk)
    const open = io.open.bind(io)
    let changed = 0, armed = true
    io.open = async (n, o) => {
      const h = await open(n, o)
      if (n !== '5.2.pack' || !armed) return h
      armed = false                                     // the delta's file only, never the fallback download's
      return {
        ...h,
        write(u8, at) {
          const s = new TextDecoder().decode(u8)
          if (s.startsWith('{"asof":"') && s.includes(',20261120,')) {
            changed++
            return h.write(new TextEncoder().encode(s.replace(',20261120,', ',20261121,')), at)   // same length
          }
          return h.write(u8, at)
        },
      }
    }
    const { eng } = await holdingBase('5', { disk, io })
    const r = await eng.ingest(k.newEntry)
    expect(changed).toBe(1)
    expect(r).toMatchObject({ status: 'ingested', via: 'full' })
    expect(r.delta).toMatch(/reads back another asof/)
  })

  it('a write that fails mid-apply (a full disk) falls back to the full pack', async () => {
    const k = caseOf('5')
    const disk = new Map()
    const { eng } = await holdingBase('5', { disk, io: crashingIO(disk, '5.2.pack', 2) })
    const r = await eng.ingest(k.newEntry)
    expect(r).toMatchObject({ status: 'ingested', via: 'full', delta: 'failed: the tab is gone' })
    expect(colsOf(eng.read('NEWSYM', '5'))).toEqual(readAll(k.next, '5').NEWSYM)
    expect(filesOn(disk)).toEqual(['5.2.ok', '5.2.pack'])
  })
})
