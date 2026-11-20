// @vitest-environment node
// The record codecs and the pack container. 'ubh1' is pinned to the PYTHON encoder: the history lake's
// own fixture (pieces built by tools/history_lake/piece.py) is re-stored with its body RAW, and must
// decode to exactly the columns the Python decoder returned.
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import lake from '../historyLake/__fixtures__/pieces.json'
import { parsePrefix, crc32 } from '../historyLake/piece'
import {
  decodeUbhRecord, decodeF64Record, codecFor, registerCodec, encodePack, trailerLengthOf, parseTrailer,
  indexEntry, PACK_TAIL_BYTES, DeviceFormatError,
} from './codec'
import { encodeUbhRecord, encodeF64Record, synthBars } from './testing/fixtures'

/** A Python-built piece with its Brotli body replaced by the raw body (what the seed stores). */
function rawOf(c) {
  const data = new Uint8Array(Buffer.from(c.b64, 'base64'))
  const { offset } = parsePrefix(data)
  const body = new Uint8Array(zlib.brotliDecompressSync(data.subarray(offset)))
  const out = new Uint8Array(offset + body.length)
  out.set(data.subarray(0, offset), 0)
  out.set(body, offset)
  return { bytes: out, body }
}

describe("'ubh1' records", () => {
  it('decode the Python encoder\'s pieces (raw body) to its exact columns, prices / volume scaled', () => {
    expect(lake.cases.length).toBeGreaterThanOrEqual(7)
    for (const c of lake.cases) {
      const got = decodeUbhRecord(rawOf(c).bytes)
      const { pscale, vscale } = c.header
      expect(Array.from(got.t)).toEqual(c.columns.t)
      for (const k of ['o', 'h', 'l', 'c']) expect(Array.from(got[k])).toEqual(c.columns[k].map((x) => x / pscale))
      expect(Array.from(got.v)).toEqual(c.columns.v.map((x) => x / vscale))
    }
  })
  it('the JS fixture encoder writes the same body bytes as the Python encoder', () => {
    for (const c of lake.cases.slice(0, 4)) {
      const { pscale, vscale, tunit } = c.header
      const rows = c.columns.t.map((t, i) => ({ t, o: c.columns.o[i] / pscale, h: c.columns.h[i] / pscale,
        l: c.columns.l[i] / pscale, c: c.columns.c[i] / pscale, v: c.columns.v[i] / vscale, n: c.columns.n[i] }))
      const mine = encodeUbhRecord(rows, { pscale, vscale, tunit, series: c.header.series, symbol: c.header.symbol })
      expect(Buffer.from(mine.body).equals(Buffer.from(rawOf(c).body))).toBe(true)
      expect(mine.crc).toBe(c.header.crc)
    }
  })
  it('exact 4-decimal prices round-trip to the same doubles', () => {
    const rows = synthBars(500, { step: 86400, t0: 1_700_006_400 })
    const got = decodeUbhRecord(encodeUbhRecord(rows).bytes)
    rows.forEach((r, i) => { expect([got.t[i], got.o[i], got.h[i], got.l[i], got.c[i], got.v[i]]).toEqual([r.t, r.o, r.h, r.l, r.c, r.v]) })
  })
  it('refuses a compressed body, a bad header CRC, a flipped body byte', () => {
    const c = lake.cases[0]
    // the shipped (Brotli) piece itself: its body is not stored raw
    expect(() => decodeUbhRecord(new Uint8Array(Buffer.from(c.b64, 'base64')))).toThrow(DeviceFormatError)
    const { bytes } = rawOf(c)
    const badHeader = bytes.slice(); badHeader[8] ^= 1
    expect(() => decodeUbhRecord(badHeader)).toThrow(/CRC/)
    const badBody = bytes.slice(); badBody[badBody.length - 3] ^= 0x01
    expect(() => decodeUbhRecord(badBody)).toThrow(DeviceFormatError)
  })
})

describe("'f64' records and the codec registry", () => {
  it('round-trips and is chosen by name; an unknown name throws; a registered one is used', () => {
    const rows = synthBars(10)
    const got = codecFor('f64')(encodeF64Record(rows).bytes)
    expect(Array.from(got.c)).toEqual(rows.map((r) => r.c))
    expect(codecFor(undefined)).toBe(decodeUbhRecord)
    expect(() => codecFor('nope')).toThrow(DeviceFormatError)
    const fn = () => ({ t: new Float64Array([1]) })
    registerCodec('test-x', fn)
    expect(codecFor('test-x')).toBe(fn)
    expect(() => decodeF64Record(new Uint8Array(13))).toThrow(DeviceFormatError)
  })
})

describe('the pack container (UBHPACK1)', () => {
  const recs = ['AAA', 'BRK-B', 'ZZZ'].map((sym, k) => ({ sym, ...encodeUbhRecord(synthBars(20 + k, { seed: k + 1 }), { symbol: sym }) }))
  const pack = encodePack(recs, { series: 'D', codec: 'ubh1', build: 'b1' })

  it('the trailer becomes an index of exact offsets / lengths / bars / first / last', () => {
    const tlen = trailerLengthOf(pack.subarray(pack.length - PACK_TAIL_BYTES), pack.length)
    const dataEnd = pack.length - PACK_TAIL_BYTES - tlen
    const idx = parseTrailer(pack.subarray(dataEnd, dataEnd + tlen), dataEnd)
    expect(idx.count).toBe(3)
    expect(idx.codec).toBe('ubh1')
    expect(idx.series).toBe('D')
    let off = 0
    for (const r of recs) {
      expect(indexEntry(idx, r.sym)).toEqual({ off, len: r.bytes.length, bars: r.bars, first: r.first, last: r.last })
      off += r.bytes.length
    }
    expect(off).toBe(dataEnd)
    // each record read back at its offset decodes
    const e = indexEntry(idx, 'BRK-B')
    expect(decodeUbhRecord(pack.slice(e.off, e.off + e.len)).t.length).toBe(21)
  })
  it('refuses a bad magic, a trailer length past the file, an entry outside the data', () => {
    const bad = pack.slice(); bad[bad.length - 1] ^= 1
    expect(() => trailerLengthOf(bad.subarray(bad.length - 16), bad.length)).toThrow(/magic/)
    const tail = pack.slice(pack.length - 16); new DataView(tail.buffer).setUint32(0, pack.length, true)
    expect(() => trailerLengthOf(tail, pack.length)).toThrow(/length/)
    const tr = new TextEncoder().encode(JSON.stringify({ v: 1, pieces: { X: [10, 100, 1, 0, 0, 0] } }))
    expect(() => parseTrailer(tr, 50)).toThrow(/range/)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})
