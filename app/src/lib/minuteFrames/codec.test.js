// @vitest-environment node
// The browser decoder against frames the PYTHON encoder wrote (tests/fixtures/minute_frames/,
// built by tests/minute_frames_fixture.py and pinned by tests/test_minute_frames.py). Every value
// must come back bit for bit: JSON carries doubles exactly (shortest round-trip form both ways).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import {
  decodeFrame, todayFrames, todayInfo, inflateIfGzip, frameRows, dailyRows, hhmmOfSeq, crc32, FrameError, NO_SEQ,
  KIND_LATE, KIND_REPLACE, FLAG_DAILY, KNOWN_FLAGS,
} from './codec'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const CASES = JSON.parse(Buffer.from(fixture('codec_cases.json')).toString('utf8')).cases

const bits = (x) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getBigUint64(0) }
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216
const putU32 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255 }

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
      // FLAG_DAILY: the server's day rows, in symbol order, bit for bit (no `av`, whatever FLAG_AV says)
      if (!c.daily) { expect(f.daily).toBeNull(); return }
      expect(f.flags & FLAG_DAILY).toBe(FLAG_DAILY)
      const got = dailyRows(f)
      const wantD = Object.entries(c.daily).sort(([a], [z]) => (a < z ? -1 : 1))
      expect(got.map((r) => r.sym)).toEqual(wantD.map(([sym]) => sym))
      got.forEach((r, i) => [r.o, r.h, r.l, r.c, r.v].forEach((x, k) => expect(bits(x)).toBe(bits(wantD[i][1][k]))))
    })
  }

  it('the DAILY cases cover symbols that are in no block, raw prices, 8 decimals, and frames with av', () => {
    const daily = CASES.filter((c) => c.daily)
    expect(daily.map((c) => c.name)).toEqual(['daily', 'daily_with_av', 'daily_only'])
    const f = decodeFrame(fixture('codec_daily.bin'))
    const inBlocks = new Set(frameRows(f).map((r) => r.sym))
    expect(dailyRows(f).map((r) => r.sym).filter((s) => !inBlocks.has(s))).toEqual(['BRK-B', 'ONLYDAY', 'PENNY', 'RAWP'])
    expect(decodeFrame(fixture('codec_daily_with_av.bin')).withAv).toBe(true)
    expect(decodeFrame(fixture('codec_daily_only.bin')).n).toBe(0)
  })

  it('a flag bit this decoder does not know is refused for good (never misread), with the header to account for it', () => {
    const raw = fixture('codec_plain.bin')
    const f = raw.slice()
    f[5] |= 0x08
    expect(KNOWN_FLAGS & 0x08).toBe(0)
    putU32(f, f.length - 4, crc32(f, 0, f.length - 4))
    let err = null
    try { decodeFrame(f) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FrameError)
    expect(err.message).toMatch(/unknown flags 0x8/)
    expect(err.frame).toMatchObject({ day: 20261118, seq: 330, prevSeq: 329, flags: 0x08 })
    // a section a decoder does not expect is trailing bytes; a flag without its section is cut short: both permanent
    const daily = fixture('codec_daily.bin')
    const noFlag = daily.slice(); noFlag[5] &= ~FLAG_DAILY; putU32(noFlag, noFlag.length - 4, crc32(noFlag, 0, noFlag.length - 4))
    expect(() => decodeFrame(noFlag)).toThrow(/trailing bytes/)
    const onlyFlag = raw.slice(); onlyFlag[5] |= FLAG_DAILY; putU32(onlyFlag, onlyFlag.length - 4, crc32(onlyFlag, 0, onlyFlag.length - 4))
    let e2 = null
    try { decodeFrame(onlyFlag) } catch (e) { e2 = e }
    expect(e2?.message).toMatch(/truncated varint/)
    expect(e2?.frame?.seq).toBe(330)
    // ...while damaged bytes (CRC) are NOT a permanent refusal: a retry may get the right ones
    const flip = raw.slice(); flip[40] ^= 1
    let e3 = null
    try { decodeFrame(flip) } catch (e) { e3 = e }
    expect(e3?.message).toMatch(/crc/)
    expect(e3?.frame).toBeNull()
  })

  it('the DAILY day (the real publisher, a restart after the close): every section as Python decoded it', () => {
    const D = JSON.parse(Buffer.from(fixture('day_daily.json')).toString('utf8'))
    const got = []
    let frames = 0
    for (const f of todayFrames(fixture('day_daily.today.bin'))) {
      frames++
      if (f.daily) got.push([f.seq, f.epoch, f.prevSeq, Object.fromEntries(dailyRows(f).map((r) => [r.sym, [r.o, r.h, r.l, r.c, r.v]]))])
    }
    expect(frames).toBe(D.frames)
    expect(got.length).toBe(D.daily_sections.length)
    got.forEach((g, i) => {
      const w = D.daily_sections[i]
      expect(g.slice(0, 3)).toEqual(w.slice(0, 3))
      expect(Object.keys(g[3]).sort()).toEqual(Object.keys(w[3]).sort())
      for (const [sym, r] of Object.entries(w[3])) r.forEach((x, k) => expect(bits(g[3][sym][k])).toBe(bits(x)))
    })
    expect(new Set(D.daily_sections.map((s) => s[1])).size).toBe(2)              // two publisher epochs
  })

  it('the day file walk can step over a refused frame (and says so) instead of ending', () => {
    const raw = fixture('day_daily.today.bin')
    const frames = [...todayFrames(raw)]
    // the same file with ONE frame refused: its flags gain a bit nobody knows (CRCs recomputed)
    const out = raw.slice()
    let pos = 16, k = 0
    const victim = 100
    while (pos < out.length - 12) {
      const len = u32(out, pos)
      if (k === victim) {
        out[pos + 4 + 5] |= 0x10
        putU32(out, pos + 4 + len - 4, crc32(out, pos + 4, pos + 4 + len - 4))
      }
      pos += 4 + len; k++
    }
    putU32(out, out.length - 4, crc32(out, 0, out.length - 4))
    expect(() => [...todayFrames(out)]).toThrow(/unknown flags/)
    const walked = [...todayFrames(out, { refused: true })]
    expect(walked.length).toBe(frames.length)
    expect(walked[victim]).toMatchObject({ refused: true, seq: frames[victim].seq, prevSeq: frames[victim].prevSeq })
    expect(walked[victim + 1].seq).toBe(frames[victim + 1].seq)
  })

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
