// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import zlib from 'node:zlib'
import fixture from './__fixtures__/pieces.json'
import {
  decodeColumns, checkHeader, PieceError, COLUMNS, crc32, encodeSymbol, pieceRelpath, indexRelpath, periodOf,
  parsePrefix, readHeader, decodeBody, decodePiece, toFloats, hasNativeBrotli, nativeBrotliInflate,
} from './piece'

// The fixture is built by the PYTHON encoder (tools/history_lake/make_js_fixture.py) from synthetic
// bars, with the columns the Python decoder returns. Agreement here is what pins the two languages.
const CASES = fixture.cases
const bytesOf = (c) => new Uint8Array(Buffer.from(c.b64, 'base64'))
const inflate = (b) => new Uint8Array(zlib.brotliDecompressSync(b))
const decode = (data) => decodePiece(data, inflate)

/** Assemble a piece from a header object and a decompressed body (what the encoder does). */
function assemble(header, body) {
  const hjson = Buffer.from(JSON.stringify(header), 'ascii')
  const prefix = Buffer.concat([Buffer.from([0x55, 0x42, 0x48, 1, hjson.length & 255, hjson.length >> 8]), hjson])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(crc32(prefix))
  return new Uint8Array(Buffer.concat([prefix, crc, zlib.brotliCompressSync(Buffer.from(body))]))
}
const split = (c) => {
  const data = bytesOf(c)
  const { header, offset } = parsePrefix(data)
  return { header, body: inflate(data.subarray(offset)) }
}

describe('history-lake piece reader', () => {
  it('has the fixture it claims to test against', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(7)
    expect(CASES.reduce((a, c) => a + c.header.bars, 0)).toBeGreaterThan(1500)
    // the cases must exercise both scales and values above 2^32, or agreement proves little
    expect(new Set(CASES.map((c) => c.header.vscale)).size).toBeGreaterThan(1)
    expect(new Set(CASES.map((c) => c.header.pscale)).size).toBeGreaterThan(1)
    expect(CASES.some((c) => c.columns.n.some((x) => x === Number.MAX_SAFE_INTEGER))).toBe(true)
    expect(CASES.some((c) => c.columns.h.some((x, i) => x < Math.max(c.columns.o[i], c.columns.c[i])))).toBe(true)
  })

  it.each(CASES.map((c) => [c.name, c]))('decodes what the Python encoder wrote: %s', async (_name, c) => {
    const got = await decode(bytesOf(c))
    expect(got.header).toEqual(c.header)
    for (const k of COLUMNS) expect(Array.from(got[k]), `column ${k}`).toEqual(c.columns[k])
    const fl = toFloats(got)
    for (const k of 'ohlcv') expect(Array.from(fl[k]), `float ${k}`).toEqual(c.floats[k])
    expect(pieceRelpath(c.series, c.symbol, c.period)).toBe(c.relpath)
    expect(readHeader(bytesOf(c))).toEqual(c.header)
  })

  it('computes the standard CRC-32', () => {
    const ascii = (s) => new Uint8Array(Buffer.from(s, 'ascii'))
    expect(crc32(ascii('123456789'))).toBe(0xCBF43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(ascii('6789'), crc32(ascii('12345')))).toBe(0xCBF43926)
    expect(crc32(ascii('hello'))).toBe(zlib.crc32(Buffer.from('hello')))
  })

  it('encodes symbols and paths the way FORMAT.md says', () => {
    expect(encodeSymbol('NVDA')).toBe('s-NVDA')
    expect(encodeSymbol('BRK.B')).toBe('s-BRK_2EB')
    expect(encodeSymbol('BACpB')).toBe('s-BAC_70B')
    expect(encodeSymbol('CON')).toBe('s-CON')
    expect(encodeSymbol('BCpC')).not.toBe(encodeSymbol('BCPC'))
    expect(indexRelpath('BRK.B')).toBe('v1/index/s-BRK_2EB.json')
    expect(() => encodeSymbol('')).toThrow(PieceError)
    expect(() => pieceRelpath('1', 'SPY', '2026')).toThrow(PieceError)
    expect(() => pieceRelpath('5', 'SPY', '2026-11')).toThrow(PieceError)
    expect(() => pieceRelpath('2', 'SPY', '2026')).toThrow(PieceError)
    expect(periodOf('1', 2026, 3)).toBe('2026-03')
    expect([1, 3, 4, 6, 7, 9, 10, 12].map((m) => periodOf('5', 2026, m)))
      .toEqual(['2026Q1', '2026Q1', '2026Q2', '2026Q2', '2026Q3', '2026Q3', '2026Q4', '2026Q4'])
    expect(periodOf('60e', 2026, 11)).toBe('2026')
  })

  it('refuses a file that is not a whole, unmodified piece', async () => {
    const good = bytesOf(CASES[0])
    const { offset } = parsePrefix(good)
    await expect(decode(new Uint8Array(0))).rejects.toThrow(/truncated/)
    for (const cut of [5, 9, offset - 5, offset - 1]) {
      await expect(decode(good.subarray(0, cut)), `cut at ${cut}`).rejects.toThrow(PieceError)
    }
    for (const cut of [offset, offset + 10, good.length - 1]) {
      await expect(decode(good.subarray(0, cut)), `cut at ${cut}`).rejects.toThrow(/corrupt or truncated|bytes, header says/)
    }
    const magic = good.slice(); magic[0] = 0x58
    await expect(decode(magic)).rejects.toThrow(/bad magic/)
    const version = good.slice(); version[3] = 2
    await expect(decode(version)).rejects.toThrow(/unsupported format version 2/)
    // every byte of the header is covered by the header CRC
    for (let i = 4; i < offset; i++) {
      const bad = good.slice(); bad[i] ^= 0x01
      expect(() => parsePrefix(bad), `flip at ${i}`).toThrow(PieceError)
    }
    await expect(decode('UBH')).rejects.toThrow(/Uint8Array/)
  })

  it('refuses a header that lies', () => {
    const { header, body } = split(CASES[2])
    const withHeader = (patch) => () => parsePrefix(assemble({ ...header, ...patch }, body))
    expect(withHeader({})).not.toThrow()
    expect(withHeader({ v: 2 })).toThrow(/version/)
    expect(withHeader({ basis: 'adj' })).toThrow(/basis/)
    expect(withHeader({ series: '2' })).toThrow(/series/)
    expect(withHeader({ tunit: 60 })).toThrow(/series\/tunit/)
    expect(withHeader({ bars: 0 })).toThrow(/no bars/)
    expect(withHeader({ bars: 1.5 })).toThrow(/bars/)
    expect(withHeader({ first: -1 })).toThrow(/first/)
    expect(withHeader({ pscale: 20 })).toThrow(/powers of ten/)
    expect(withHeader({ vscale: 1e10 })).toThrow(/powers of ten/)
    expect(withHeader({ symbol: '' })).toThrow(/symbol/)
    expect(withHeader({ period: '2026' })).toThrow(/period/)
    const missing = { ...header }; delete missing.crc
    expect(() => parsePrefix(assemble(missing, body))).toThrow(/missing required keys/)
  })

  it('refuses a body that does not decode to exactly the bars the header describes', async () => {
    const { header, body } = split(CASES[2])
    const n = header.bars
    await expect(decode(assemble(header, body))).resolves.toBeTruthy()

    // one changed value: every structural check passes, the column CRC does not
    const changed = body.slice()
    const last = changed.length - 1
    changed[last] = changed[last] === 5 ? 6 : 5
    await expect(decode(assemble(header, changed))).rejects.toThrow(/column CRC mismatch/)

    await expect(decode(assemble({ ...header, body: body.length + 1 }, body))).rejects.toThrow(/bytes, header says/)
    const extra = new Uint8Array([...body, 1])
    await expect(decode(assemble({ ...header, body: extra.length }, extra))).rejects.toThrow(/left over/)
    const short = body.subarray(0, body.length - 1)
    await expect(decode(assemble({ ...header, body: short.length }, short))).rejects.toThrow(PieceError)
    // a bar count the body cannot hold is refused before anything is allocated for it
    await expect(decode(assemble({ ...header, bars: 2 ** 40 }, body))).rejects.toThrow(/fewer than/)
    await expect(decode(assemble({ ...header, first: header.first + header.tunit }, body))).rejects.toThrow(/first\/last/)
    await expect(decode(assemble({ ...header, crc: (header.crc + 1) % 2 ** 32 }, body))).rejects.toThrow(/column CRC/)

    // hand-built one-bar bodies: T O H L C V VF N
    const one = { ...header, bars: 1, tunit: 300, vscale: 1, pscale: 1 }
    const tUnits = Math.floor(header.first / 300)
    const varint = (x) => { const out = []; do { let b = x % 128; x = Math.floor(x / 128); if (x > 0) b += 128; out.push(b) } while (x > 0); return out }
    const T = varint(tUnits)
    const mk = (cols, patch = {}) => {
      const b = new Uint8Array(cols.flat())
      return assemble({ ...one, first: tUnits * 300, last: tUnits * 300, body: b.length, ...patch }, b)
    }
    const okCols = [T, [20], [0], [0], [0], [7], [0], [3]]             // o = c = h = l = 10, v = 7, n = 3
    const ok = await decode(mk(okCols, { crc: 0 })).catch((e) => e)
    expect(String(ok)).toMatch(/column CRC/)                             // structurally valid: only the CRC is unknown
    await expect(decode(mk([T, [20], [0], [0], [0], [7], [1], [3]]))).rejects.toThrow(/fractional volume/)
    await expect(decode(mk([T, [0x94, 0x00], [0], [0], [0], [7], [0], [3]]))).rejects.toThrow(/non-canonical/)
    await expect(decode(mk([T, [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01], [0], [0], [0], [7], [0], [3]])))
      .rejects.toThrow(/longer than 8 bytes/)
    await expect(decode(mk([T, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F], [0], [0], [0], [7], [0], [3]])))
      .rejects.toThrow(/above 2\*\*53/)
    await expect(decode(mk([T, [1], [0], [0], [0], [7], [0], [3]]))).rejects.toThrow(/'o' is out of range/)   // open = -1
    await expect(decode(mk([T, [20], [0], [0], [0], [7], [0], [0x83]]))).rejects.toThrow(/ends inside a varint/)

    // two bars whose second time does not advance
    const two = [[...T, 0], [20, 0], [0, 0], [0, 0], [0, 0], [7, 7], [0, 0], [3, 3]]
    const b2 = new Uint8Array(two.flat())
    await expect(decode(assemble({ ...one, bars: 2, first: tUnits * 300, last: tUnits * 300, body: b2.length }, b2)))
      .rejects.toThrow(/strictly increasing/)
    expect(() => decodeBody(one, 'nope')).toThrow(/Uint8Array/)
  })

  it('reports a failing decompressor as a corrupt piece', async () => {
    const good = bytesOf(CASES[5])
    await expect(decodePiece(good, () => { throw new Error('boom') })).rejects.toThrow(/corrupt or truncated: boom/)
    await expect(decodePiece(good, async () => { throw new PieceError('mine') })).rejects.toThrow(/^mine$/)
    // an ArrayBuffer-ish result is accepted
    const viaBuffer = await decodePiece(good, (b) => zlib.brotliDecompressSync(b))
    expect(Array.from(viaBuffer.c)).toEqual(CASES[5].columns.c)
  })

  // ⚰️ 2026-11-17 — THIS ASSERTED THE RUNTIME'S VERSION, NOT THE CODE. It said "Node 24 (this suite) has
  // it" and required `hasNativeBrotli()` to be true, but every CI workflow pins Node 20 (and the Pine runtime
  // parity lanes stay on Node 20.20.2 by rule), where `DecompressionStream('brotli')` does not exist, so it
  // was red on every CI vitest run (remote run 44066213548) while saying nothing about piece.js. The code
  // under test is browser code (source.js, the browser history source): its contract is the CAPABILITY.
  // Where the platform has a Brotli decoder it must decode every piece; where it has none, the probe must
  // say so and the default decode must refuse BY NAME. Both halves are asserted on every runtime: the
  // absent half by hiding the decoder from a fresh module, the present half on the real platform decoder
  // where one exists (Node >= 24, current browsers; skipped with the reason in its title on Node 20).
  const PLATFORM_BROTLI = (() => {
    try { new DecompressionStream('brotli'); return true } catch { return false }
  })()

  it('the probe reports the platform capability, whatever the runtime', () => {
    expect(hasNativeBrotli()).toBe(PLATFORM_BROTLI)
  })

  it('a platform with no Brotli decoder is refused BY NAME, never decoded wrong', async () => {
    const Real = globalThis.DecompressionStream
    vi.resetModules()
    vi.stubGlobal('DecompressionStream', class extends Real {
      constructor(format) {
        if (format === 'brotli') throw new TypeError(`Unsupported compression format: '${format}'`)
        super(format)
      }
    })
    try {
      const fresh = await import('./piece')
      expect(fresh.hasNativeBrotli()).toBe(false)
      const good = bytesOf(CASES[0])
      await expect(fresh.nativeBrotliInflate(good)).rejects.toThrow(/this platform has no Brotli decoder/)
      const err = await fresh.decodePiece(good).catch((e) => e)
      expect(err).toBeInstanceOf(fresh.PieceError)
      expect(err.message).toMatch(/this platform has no Brotli decoder/)
      // the same bytes still decode with a decompressor handed in: the refusal is the platform's, not the piece's
      const viaZlib = await fresh.decodePiece(good, inflate)
      expect(Array.from(viaZlib.c)).toEqual(CASES[0].columns.c)
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it.skipIf(!PLATFORM_BROTLI)(`decodes with the platform Brotli decoder where there is one${PLATFORM_BROTLI ? ''
    : " (SKIPPED: this runtime has no DecompressionStream('brotli'), e.g. Node 20; runs on Node >= 24)"}`, async () => {
    expect(hasNativeBrotli()).toBe(true)
    for (const c of CASES) {
      const got = await decodePiece(bytesOf(c))
      for (const k of COLUMNS) expect(Array.from(got[k])).toEqual(c.columns[k])
    }
    const good = bytesOf(CASES[0])
    const { offset } = parsePrefix(good)
    await expect(decodePiece(good.subarray(0, good.length - 7))).rejects.toThrow(PieceError)
    await expect(nativeBrotliInflate(good.subarray(offset))).resolves.toHaveLength(CASES[0].header.body)
  })

  it('decodes what the edge sends: header text plus an already-inflated body', () => {
    for (const c of CASES) {
      const data = bytesOf(c)
      const { header, offset } = parsePrefix(data)
      const body = inflate(data.subarray(offset))
      const got = decodeColumns(JSON.stringify(header), body)
      expect(got.header).toEqual(c.header)
      for (const k of COLUMNS) expect(Array.from(got[k])).toEqual(c.columns[k])
      // an ArrayBuffer body (what fetch().arrayBuffer() gives) is accepted
      const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
      expect(Array.from(decodeColumns(JSON.stringify(header), ab).c)).toEqual(c.columns.c)
    }
    const data = bytesOf(CASES[0])
    const { header, offset } = parsePrefix(data)
    const body = inflate(data.subarray(offset))
    expect(() => decodeColumns('{not json', body)).toThrow(/not valid JSON/)
    expect(() => decodeColumns('null', body)).toThrow(/missing required keys/)
    // this path has no header CRC, so the field checks and the column CRC carry it
    expect(() => decodeColumns(JSON.stringify({ ...header, basis: 'adj' }), body)).toThrow(/unsupported basis/)
    expect(() => decodeColumns(JSON.stringify({ ...header, crc: header.crc + 1 }), body)).toThrow(/column CRC/)
    expect(() => decodeColumns(JSON.stringify({ ...header, pscale: 7 }), body)).toThrow(/powers of ten/)
    expect(() => decodeColumns(JSON.stringify({ ...header, bars: header.bars - 1 }), body)).toThrow(PieceError)
    const flipped = body.slice(); flipped[flipped.length >> 1] ^= 1
    expect(() => decodeColumns(JSON.stringify(header), flipped)).toThrow(PieceError)
    expect(checkHeader(header)).toBe(header)
  })
})
