// @vitest-environment node
// The browser decoder against frames the PYTHON encoder wrote (tests/fixtures/minute_frames/,
// built by tests/minute_frames_fixture.py and pinned by tests/test_minute_frames.py). Every value
// must come back bit for bit: JSON carries doubles exactly (shortest round-trip form both ways).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import zlib from 'node:zlib'
import {
  decodeFrame, todayFrames, todayInfo, inflateIfGzip, frameRows, hhmmOfSeq, crc32, FrameError, NO_SEQ,
  KIND_LATE, KIND_REPLACE,
} from './codec'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const CASES = JSON.parse(Buffer.from(fixture('codec_cases.json')).toString('utf8')).cases

const bits = (x) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getBigUint64(0) }

describe('minute frame codec: the Python encoder\'s bytes, decoded in the browser', () => {
  for (const c of CASES) {
    it(`${c.name}: header and every value, bit for bit`, () => {
      const f = decodeFrame(fixture(c.file))
      expect({ day: f.day, seq: f.seq, prevSeq: f.prevSeq, epoch: f.epoch, minute: f.minute,
        complete: f.complete, withAv: f.withAv }).toEqual(c.header)
      expect(f.blocks.map((b) => [b.minute, b.kind])).toEqual(c.blocks.map((b) => [b.minute, b.kind]))
      const rows = frameRows(f)
      const want = c.blocks.flatMap((b) => Object.entries(b.rows).sort(([a], [z]) => (a < z ? -1 : 1))
        .map(([sym, r]) => ({ minute: b.minute, sym, r })))
      expect(rows.length).toBe(want.length)
      rows.forEach((row, i) => {
        const w = want[i]
        expect(row.sym).toBe(w.sym)
        const got = [row.o, row.h, row.l, row.c, row.v]
        w.r.slice(0, 5).forEach((x, k) => expect(bits(got[k])).toBe(bits(x)))
        if (c.header.withAv) {
          if (w.r[5] == null) expect(row.av).toBeNull()
          else expect(bits(row.av)).toBe(bits(w.r[5]))
        }
      })
    })
  }

  it('a frame inflates from gzip with the platform decoder (what R2 stores)', async () => {
    const raw = fixture('codec_plain.bin')
    const gz = new Uint8Array(zlib.gzipSync(raw))
    expect(Array.from(await inflateIfGzip(gz))).toEqual(Array.from(raw))
    expect(await inflateIfGzip(raw)).toBe(raw)              // already inflated: untouched
  })

  it('a damaged frame is refused, never half read', () => {
    const raw = fixture('codec_plain.bin')
    const flip = raw.slice(); flip[40] ^= 1
    expect(() => decodeFrame(flip)).toThrow(FrameError)
    expect(() => decodeFrame(raw.slice(0, raw.length - 5))).toThrow(FrameError)
    const magic = raw.slice(); magic[0] = 88
    expect(() => decodeFrame(magic)).toThrow(/not a minute frame/)
  })

  it('the day file yields every frame in order, linked by prevSeq, with its late and replace blocks', () => {
    const raw = fixture('day_regular.today.bin')
    const info = todayInfo(raw)
    expect(info.seq).toBe(959)
    const seqs = []
    const kinds = []
    let prev = NO_SEQ
    for (const f of todayFrames(raw)) {
      expect(f.prevSeq).toBe(prev)
      prev = f.seq
      seqs.push(f.seq)
      for (const b of f.blocks) if (b.kind) kinds.push(b.kind)
    }
    expect(seqs).toEqual(Array.from({ length: 960 }, (_, i) => i))
    expect(kinds.sort()).toEqual([KIND_LATE, KIND_REPLACE])
    const cut = raw.slice(); cut[cut.length - 1] ^= 1
    expect(() => todayInfo(cut)).toThrow(/crc/)
  })

  it('names, clock and CRC agree with the server', () => {
    expect([hhmmOfSeq(0), hhmmOfSeq(330), hhmmOfSeq(959)]).toEqual(['0400', '0930', '1959'])
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926)
  })
})
