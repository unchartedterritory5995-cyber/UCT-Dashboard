// @vitest-environment node
// The first-frame seed reader (UFFSEED1, docs/charts/first-frame-seed-format.md), pinned to the PYTHON
// encoder: __fixtures__/ffseed.json is a copy of edge/bars-edge-router/__fixtures__/ffseed.json from the
// seed's branch (feat/first-frame-seed a6ca191c47, built by tools/ffseed_make_js_fixture.py from
// api/services/ffseed_format.py; synthetic bars), with the served rows every symbol must decode to.
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import FIX from './__fixtures__/ffseed.json'
import {
  trailerLengthOf, parseTrailer, decodeRecord, indexEntry, registerComp, PACK_TAIL_BYTES, SEED_FIELDS, DeviceFormatError,
} from './codec'
import { encodeSeedBody, seedPackOf, synthBars } from './testing/fixtures'

const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
/** index + a reader of one symbol, the way the worker does it (tail → trailer → one positioned slice). */
function open(pack, tf) {
  const tlen = trailerLengthOf(pack.subarray(pack.length - PACK_TAIL_BYTES), pack.length)
  const dataEnd = pack.length - PACK_TAIL_BYTES - tlen
  const index = parseTrailer(pack.subarray(dataEnd, dataEnd + tlen), dataEnd, { tf })
  const read = (sym) => {
    const i = index.row.get(sym)
    if (i == null) return null
    return decodeRecord(index, i, pack.slice(index.off[i], index.off[i] + index.len[i]))
  }
  return { index, read, dataEnd }
}
/** Rebuild `pack` with its trailer edited by `fn` (the blobs unchanged). */
function withTrailer(pack, fn) {
  const { dataEnd } = open(pack)
  const tlen = pack.length - PACK_TAIL_BYTES - dataEnd
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
const dayLabel = (t) => new Date(t * 1000).toISOString().slice(0, 10)

describe('UFFSEED1, against the Python encoder', () => {
  it('has the fixture it claims to test against (both scales, a fractional volume, a dotted symbol, 3 tfs)', () => {
    expect(Object.keys(FIX.packs).sort()).toEqual(['5', '60', 'D'])
    const all = Object.values(FIX.expected).flatMap((s) => Object.values(s).flat())
    expect(all.length).toBeGreaterThan(500)
    expect(all.some((r) => !Number.isInteger(r.v))).toBe(true)
    expect(Object.keys(FIX.expected['5'])).toContain('ZZ.B')
  })

  it('every symbol of every pack decodes to EXACTLY the served rows', () => {
    for (const [tf, syms] of Object.entries(FIX.expected)) {
      const { read, index } = open(bytesOf(FIX.packs[tf]), tf)
      expect(index.comp).toBe('gzip')
      expect(index.build).toBe(FIX.build)
      expect(index.count).toBe(Object.keys(syms).length)
      for (const [sym, rows] of Object.entries(syms)) {
        const c = read(sym)
        expect(c.t.length).toBe(rows.length)
        rows.forEach((r, i) => {
          expect(tf === 'D' ? dayLabel(c.t[i]) : c.t[i]).toBe(r.t)
          expect([c.o[i], c.h[i], c.l[i], c.c[i], c.v[i]]).toEqual([r.o, r.h, r.l, r.c, r.v])
        })
      }
      expect(read('NOPE')).toBeNull()                       // a missing symbol: no device copy
    }
  })

  it('the JS test encoder writes the same body, scales and CRC as the Python encoder', () => {
    for (const [tf, syms] of Object.entries(FIX.expected)) {
      const pack = bytesOf(FIX.packs[tf])
      const { index } = open(pack, tf)
      for (const [sym, rows] of Object.entries(syms)) {
        const e = indexEntry(index, sym)
        const pyBody = zlib.gunzipSync(Buffer.from(pack.subarray(e.off, e.off + e.len)))
        const mine = encodeSeedBody(rows, { tunit: index.tunit })
        expect(Buffer.from(mine.body).equals(pyBody)).toBe(true)
        expect([mine.crc, mine.pscale, mine.vscale, mine.bars, mine.first, mine.last]).toEqual([e.crc, e.pscale, e.vscale, e.bars, e.first, e.last])
      }
    }
  })
})

describe('UFFSEED1 reader refusals (a failed check is never painted)', () => {
  const pack = seedPackOf({ AAA: synthBars(300), BBB: synthBars(50, { seed: 2 }) }, { tf: '5' })

  it('the file: magic, version, kind, fields, tf / tunit, comp, ranges, scales', () => {
    expect(open(pack, '5').index.count).toBe(2)
    const v2 = pack.slice(); v2[v2.length - 1] = 0x32                            // "UFFSEED2"
    expect(() => open(v2, '5')).toThrow(/UFFSEED1/)
    const bad = (fn) => () => open(withTrailer(pack, fn), '5')
    expect(bad((t) => { t.v = 2 })).toThrow(DeviceFormatError)
    expect(bad((t) => { t.kind = 'lake' })).toThrow(DeviceFormatError)
    expect(bad((t) => { t.fields = [...SEED_FIELDS].reverse() })).toThrow(/fields/)
    expect(bad((t) => { t.tunit = 60 })).toThrow(/tunit/)
    expect(bad((t) => { t.comp = 'br' })).toThrow(/comp/)
    expect(bad((t) => { t.symbols.AAA[0] = 10 ** 9 })).toThrow(/range/)
    expect(bad((t) => { t.symbols.AAA[8] = 3 })).toThrow(/scales/)
    expect(() => open(pack, '60')).toThrow(/expected 60/)                       // the wrong tf's file
  })

  it('a record: an inflated length other than `body`, a CRC that does not match', () => {
    const longer = withTrailer(pack, (t) => { t.symbols.AAA[7] += 1 })
    expect(() => open(longer, '5').read('AAA')).toThrow(DeviceFormatError)
    const shorter = withTrailer(pack, (t) => { t.symbols.AAA[7] -= 1 })
    expect(() => open(shorter, '5').read('AAA')).toThrow(DeviceFormatError)
    const crc = withTrailer(pack, (t) => { t.symbols.AAA[6] = (t.symbols.AAA[6] + 1) % 4294967296 })
    expect(() => open(crc, '5').read('AAA')).toThrow(/CRC/)
    expect(open(crc, '5').read('BBB').t.length).toBe(50)                        // only that entry
  })

  it("'raw' blobs read without an inflate; another compression can be registered", () => {
    const rows = synthBars(80, { seed: 9 })
    const raw = seedPackOf({ RAW: rows }, { tf: '5', comp: 'raw' })
    expect(Array.from(open(raw, '5').read('RAW').c)).toEqual(rows.map((r) => r.c))
    const calls = []
    registerComp('test-x', (blob, n) => { calls.push(n); return blob })
    const x = withTrailer(raw, (t) => { t.comp = 'test-x' })
    expect(open(x, '5').read('RAW').t.length).toBe(80)
    expect(calls.length).toBe(1)
  })
})
