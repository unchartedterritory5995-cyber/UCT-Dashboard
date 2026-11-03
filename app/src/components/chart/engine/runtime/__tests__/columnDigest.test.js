// app/src/components/chart/engine/runtime/__tests__/columnDigest.test.js
//
// ─── W5 T3 — THE CANONICAL COLUMN CODEC, JS HALF, HELD TO THE SHARED FIXTURE ──────
//
// ⭐ THE FIXTURE IS THE ONE AUTHORITY: `tests/fixtures/pine_runtime/codec_parity.json`.
// `tests/test_pine_runtime_codec.py` reads the SAME file and holds the Python half
// (`api/services/pine_runtime_codec.py`) to the same bytes and the same digests, so a
// rule changed in one language only fails the other. This file can rewrite the fixture's
// `expect` blocks from its own codec (`PINE_CODEC_FIXTURE_WRITE=1`); the inputs, the
// `equal` groups and the refusals are authored by hand and never rewritten.
//
// What it proves (each normalisation rule is mutation-proved, see the commit message):
//   - every case: the preimage bytes, each column's bytes and the digest equal the fixture;
//   - na is ONE value (null, undefined and every NaN payload and sign) and -0 is not +0;
//   - the fixture DISTINGUISHES: the cases fall into exactly the declared equal groups, and
//     a fixture whose cases all digest alike is rejected by the same check;
//   - round trip: decode(encode(x)) is x, encode(decode(b)) is b, strict on non-canonical bytes;
//   - the codec's layout, hand-assembled from the header comment for one small run;
//   - sha256 against node:crypto, base64 strictness, and the engine identity read from the
//     modules that declare it (never retyped).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

import {
  CodecError, ENGINE_FIELDS, CODEC_TAG, canonicalPreimage, columnDigest, encodeColumn, decodeColumn,
  sha256Hex, bytesToHex, hexToBytes, bytesToB64, b64ToBytes,
} from '../columnDigest'
import { SCRIPT_ENGINE_VERSION } from '../../scriptEngineVersion'
import { RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION } from '../../ast/pineRuntimeFrontend'
import { RUNTIME_IR_VERSION } from '../ir'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/pine_runtime/codec_parity.json')
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

const HEX16 = /^[0-9a-f]{16}$/
const f64 = (hex) => new DataView(hexToBytes(hex).buffer).getFloat64(0, true)

/** A fixture element -> a JS value. null -> null, "undef" -> undefined, 16 hex digits -> the
 *  Float64 stored little-endian in those bytes; anything else is passed through untouched
 *  (the refusal cases rely on that). */
const element = (e) => (e === 'undef' ? undefined : typeof e === 'string' && HEX16.test(e) ? f64(e) : e)

/** The same column as a Float64Array built straight from the bytes, so a NaN payload is in
 *  the buffer before any JS number exists. na (null / undefined) becomes the canonical NaN. */
function typedColumn(col) {
  const bytes = new Uint8Array(col.length * 8)
  col.forEach((e, i) => {
    const h = typeof e === 'string' && HEX16.test(e) ? e : '000000000000f87f'
    bytes.set(hexToBytes(h), i * 8)
  })
  return new Float64Array(bytes.buffer)
}

const inputOf = (c, mode) => {
  let columns = c.columns
  if (columns !== null && typeof columns === 'object' && !Array.isArray(columns)) {
    columns = {}
    for (const [k, col] of Object.entries(c.columns)) {
      columns[k] = !Array.isArray(col) ? col : mode === 'typed' ? typedColumn(col) : col.map(element)
    }
  }
  return { engine: c.engine, columns, refusals: c.refusals, rows: c.rows }
}

const expectOf = (c) => {
  const run = inputOf(c, 'array')
  const pre = canonicalPreimage(run)
  const columns_hex = {}
  for (const k of Object.keys(run.columns)) columns_hex[k] = bytesToHex(encodeColumn(run.columns[k]))
  return { columns_hex, preimage_hex: bytesToHex(pre), digest: sha256Hex(pre) }
}

if (process.env.PINE_CODEC_FIXTURE_WRITE === '1') {
  for (const c of doc.cases) c.expect = expectOf(c)
  fs.writeFileSync(FIXTURE, JSON.stringify(doc, null, 1) + '\n')
}

/** What a rail on "the fixture can tell cases apart" asks: the digests partition the cases
 *  into EXACTLY the declared equal groups. Returns the problems found (empty = fine). */
function distinguishingProblems(digestByName, groups) {
  const problems = []
  const groupOf = new Map()
  for (const g of groups) for (const n of g.cases) groupOf.set(n, g)
  const byDigest = new Map()
  for (const [name, d] of Object.entries(digestByName)) {
    if (!byDigest.has(d)) byDigest.set(d, [])
    byDigest.get(d).push(name)
  }
  for (const names of byDigest.values()) {
    if (names.length < 2) continue
    const g = groupOf.get(names[0])
    const same = g && names.length === g.cases.length && names.every((n) => groupOf.get(n) === g)
    if (!same) problems.push(`collision: ${names.join(', ')}`)
  }
  for (const g of groups) {
    const ds = new Set(g.cases.map((n) => digestByName[n]))
    if (ds.size !== 1) problems.push(`group split: ${g.cases.join(', ')}`)
  }
  if (byDigest.size < 2) problems.push('every case produced one digest')
  return problems
}

describe('codec_parity.json, JS half', () => {
  it('the fixture is shaped as the Python half reads it', () => {
    expect(Object.keys(doc).sort()).toEqual(['cases', 'decode_refuse', 'engine', 'equal', 'refuse'])
    expect(doc.cases.length).toBeGreaterThanOrEqual(40)
    expect(new Set(doc.cases.map((c) => c.name)).size).toBe(doc.cases.length)
    expect(doc.cases.every((c) => c.expect && c.expect.digest && c.expect.preimage_hex)).toBe(true)
  })

  for (const mode of ['array', 'typed']) {
    describe(`columns given as ${mode === 'array' ? 'plain Arrays' : 'Float64Arrays built from the raw bytes'}`, () => {
      for (const c of doc.cases) {
        it(`${c.name}: bytes and digest equal the fixture`, () => {
          const run = inputOf(c, mode)
          expect(bytesToHex(canonicalPreimage(run))).toBe(c.expect.preimage_hex)
          expect(columnDigest(run)).toBe(c.expect.digest)
          for (const [k, col] of Object.entries(run.columns)) {
            expect(bytesToHex(encodeColumn(col))).toBe(c.expect.columns_hex[k])
          }
        })
      }
    })
  }

  it('every case digest is a sha256 of its own recorded preimage', () => {
    for (const c of doc.cases) {
      expect(createHash('sha256').update(Buffer.from(c.expect.preimage_hex, 'hex')).digest('hex')).toBe(c.expect.digest)
    }
  })

  it('CONTROL: the cases fall into exactly the declared equal groups', () => {
    const digests = Object.fromEntries(doc.cases.map((c) => [c.name, c.expect.digest]))
    for (const g of doc.equal) for (const n of g.cases) expect(digests[n], n).toBeDefined()
    expect(distinguishingProblems(digests, doc.equal)).toEqual([])
    // and the live codec, not just the recorded digests, partitions them the same way
    const live = Object.fromEntries(doc.cases.map((c) => [c.name, columnDigest(inputOf(c, 'array'))]))
    expect(distinguishingProblems(live, doc.equal)).toEqual([])
  })

  it('CONTROL: the check itself rejects a fixture that cannot distinguish', () => {
    const names = doc.cases.map((c) => c.name)
    expect(distinguishingProblems(Object.fromEntries(names.map((n) => [n, 'x'])), doc.equal).length).toBeGreaterThan(0)
    const live = Object.fromEntries(doc.cases.map((c) => [c.name, c.expect.digest]))
    // collapsing -0 into +0 would put these two in one bucket, outside any declared group
    const collapsed = { ...live, neg_zero: live.pos_zero }
    expect(distinguishingProblems(collapsed, doc.equal).join()).toMatch(/collision: .*neg_zero/)
    // a split group is caught too
    const split = { ...live, na_nan_negative: live.pos_zero }
    expect(distinguishingProblems(split, doc.equal).join()).toMatch(/group split/)
  })

  it('the named distinctions the design cares about hold', () => {
    const d = Object.fromEntries(doc.cases.map((c) => [c.name, c.expect.digest]))
    const apart = [
      ['neg_zero', 'pos_zero'], ['na_null', 'pos_zero'], ['na_nan', 'pos_infinity'], ['pos_infinity', 'neg_infinity'],
      ['na_nan', 'neg_infinity'], ['refusal_per_output_bar_null', 'refusal_per_output_bar_zero'],
      ['refusals_single', 'refusals_duplicate'], ['one_ulp_apart_a', 'one_ulp_apart_b'], ['keys_ab', 'keys_swapped_values'],
      ['keys_ab', 'boundary_one_column'], ['engine_boundary_a', 'engine_boundary_b'],
      ['engine_base', 'engine_script_engine'], ['engine_base', 'engine_language'], ['engine_base', 'engine_frontend'],
      ['engine_base', 'engine_ir'], ['engine_base', 'engine_bundle'], ['refusal_run_wide', 'refusal_other_guard'],
      ['refusal_per_output', 'refusal_other_key'], ['keys_utf8_order_a', 'keys_utf8_order_reversed_values'],
    ]
    for (const [a, b] of apart) expect(d[a], `${a} vs ${b}`).not.toBe(d[b])
  })

  it('na is one value on the wire; -0 and the infinities are not na', () => {
    const NAN = '000000000000f87f'
    for (const x of [null, undefined, NaN, f64('010000000000f87f'), f64('010000000000f07f'), f64('000000000000f8ff')]) {
      expect(bytesToHex(encodeColumn([x]))).toBe(NAN)
    }
    expect(bytesToHex(encodeColumn([-0]))).toBe('0000000000000080')
    expect(bytesToHex(encodeColumn([0]))).toBe('0000000000000000')
    expect(bytesToHex(encodeColumn([Infinity, -Infinity]))).toBe('000000000000f07f000000000000f0ff')
  })

  it('refuses every input the fixture lists, by CodecError', () => {
    expect(doc.refuse.length).toBeGreaterThanOrEqual(30)
    for (const r of doc.refuse) {
      expect(() => canonicalPreimage(inputOf(r, 'array')), r.name).toThrow(CodecError)
    }
  })

  it('refuses every byte string the fixture lists as not decodable', () => {
    expect(doc.decode_refuse.length).toBeGreaterThanOrEqual(4)
    for (const r of doc.decode_refuse) {
      expect(() => decodeColumn(hexToBytes(r.hex), r.rows), r.name).toThrow(CodecError)
    }
  })

  it('the fixture\'s engine block is accepted and is exactly the identity fields', () => {
    expect(Object.keys(doc.engine)).toEqual([...ENGINE_FIELDS])
  })
})

describe('round trip', () => {
  it('decode(encode(x)) is x, bit for bit, and encode(decode(b)) is b', () => {
    for (const c of doc.cases) {
      for (const col of Object.values(inputOf(c, 'array').columns)) {
        const bytes = encodeColumn(col)
        const back = decodeColumn(bytes, col.length)
        expect(back.length).toBe(col.length)
        col.forEach((x, i) => {
          if (x === null || x === undefined || x !== x) expect(Number.isNaN(back[i])).toBe(true)
          else expect(Object.is(back[i], x)).toBe(true)
        })
        expect(bytesToHex(encodeColumn(back))).toBe(bytesToHex(bytes))
      }
    }
  })

  it('-0 survives the round trip as -0, not +0', () => {
    expect(Object.is(decodeColumn(encodeColumn([-0]))[0], -0)).toBe(true)
    expect(Object.is(decodeColumn(encodeColumn([0]))[0], 0)).toBe(true)
  })

  it('a decoded view onto a larger buffer reads only its own bytes', () => {
    const big = new Uint8Array(40)
    big.set(encodeColumn([1.5, 2.5]), 8)
    expect(Array.from(decodeColumn(big.subarray(8, 24), 2))).toEqual([1.5, 2.5])
  })

  it('decode is strict: whole rows, the asked-for count, canonical NaN only', () => {
    expect(() => decodeColumn(new Uint8Array(7))).toThrow(CodecError)
    expect(() => decodeColumn(new Uint8Array(16), 3)).toThrow(CodecError)
    expect(() => decodeColumn(hexToBytes('010000000000f87f'))).toThrow(CodecError)
    expect(() => decodeColumn(hexToBytes('000000000000f8ff'))).toThrow(CodecError)
    expect(() => decodeColumn([0, 0, 0, 0, 0, 0, 0, 0])).toThrow(CodecError)
    expect(decodeColumn(new Uint8Array(0)).length).toBe(0)
  })

  it('base64 round trips and refuses non-canonical text', () => {
    const b = randomBytes(1000)
    expect(bytesToB64(new Uint8Array(b))).toBe(b.toString('base64'))
    expect(Buffer.from(b64ToBytes(b.toString('base64'))).equals(b)).toBe(true)
    for (const bad of ['AA', 'AA=', 'A===', ' AAAA', 'AAAA\n', 'AA==AA==', 'AB==', 'A$AA', 7]) {
      expect(() => b64ToBytes(bad), String(bad)).toThrow(CodecError)
    }
    expect(b64ToBytes('').length).toBe(0)
  })

  it('a column of 70,000 rows (past one chunk of the base64 helper) round trips', () => {
    const col = Array.from({ length: 70000 }, (_, i) => (i % 7 === 0 ? null : i / 3))
    const bytes = encodeColumn(col)
    expect(Buffer.from(b64ToBytes(bytesToB64(bytes))).equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('the layout, hand-assembled from the header comment', () => {
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const str = (s) => Buffer.concat([le32(Buffer.byteLength(s)), Buffer.from(s)])

  it('two columns (given b before a), a bar refusal and a run-wide refusal (given the wrong way round)', () => {
    const e = doc.engine
    const want = Buffer.concat([
      str(CODEC_TAG),
      str(String(e.script_engine)), str(e.runtime_language), str(String(e.runtime_frontend)), str(String(e.runtime_ir)), str(e.bundle_sha256),
      le32(2),
      str('a'), le32(2), Buffer.from('0000000000000080' + '000000000000f03f', 'hex'),
      str('b'), le32(2), Buffer.from('000000000000f03f' + '000000000000f87f', 'hex'),
      le32(2),
      str('*'), str('g'), Buffer.from([0]),
      str('b'), str('z'), Buffer.from([1]), le32(300),
    ])
    const got = canonicalPreimage({
      engine: e,
      columns: { b: [1, null], a: [-0, 1] },
      refusals: [{ key: 'b', guard: 'z', bar: 300, sentence: 'ignored' }, { key: '*', guard: 'g', bar: null }],
    })
    expect(bytesToHex(got)).toBe(want.toString('hex'))
    expect(columnDigest({ engine: e, columns: { b: [1, null], a: [-0, 1] }, refusals: [{ key: 'b', guard: 'z', bar: 300 }, { key: '*', guard: 'g' }] }))
      .toBe(createHash('sha256').update(want).digest('hex'))
  })
})

describe('sha256 (pure JS) against node:crypto', () => {
  it('every length across the padding boundaries, and a few large inputs', () => {
    for (let n = 0; n <= 200; n++) {
      const b = randomBytes(n)
      expect(sha256Hex(new Uint8Array(b))).toBe(createHash('sha256').update(b).digest('hex'))
    }
    for (const n of [1000, 4096, 65536, 70001, 1310720]) {
      const b = randomBytes(n)
      expect(sha256Hex(new Uint8Array(b))).toBe(createHash('sha256').update(b).digest('hex'))
    }
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('input shapes', () => {
  const e = doc.engine
  it('a hole in an Array is na; a Float64Array is read as it is', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(bytesToHex(encodeColumn([1, , 3]))).toBe(bytesToHex(encodeColumn([1, null, 3])))
    expect(columnDigest({ engine: e, columns: { v: new Float64Array([1, NaN, -0]) } }))
      .toBe(columnDigest({ engine: e, columns: { v: [1, undefined, -0] } }))
  })

  it('refuses what is not a number, an Array or a Float64Array', () => {
    for (const bad of ['abc', 5, { length: 1, 0: 1 }, new Float32Array(1), new Uint8Array(8), new Int32Array(1)]) {
      expect(() => encodeColumn(bad)).toThrow(CodecError)
    }
    for (const bad of [[1n], [Symbol('x')], ['1'], [{}], [[1]], [true]]) {
      expect(() => encodeColumn(bad)).toThrow(CodecError)
    }
  })

  it('rows, when given, is held against every column', () => {
    expect(() => canonicalPreimage({ engine: e, columns: { v: [1, 2] }, rows: 2 })).not.toThrow()
    expect(() => canonicalPreimage({ engine: e, columns: { v: [1, 2] }, rows: 3 })).toThrow(CodecError)
  })

  it('the engine identity can be read from the modules that declare it (never retyped)', () => {
    const live = {
      script_engine: SCRIPT_ENGINE_VERSION,
      runtime_language: RUNTIME_FRONTEND_LANGUAGE,
      runtime_frontend: RUNTIME_FRONTEND_VERSION,
      runtime_ir: RUNTIME_IR_VERSION,
      bundle_sha256: e.bundle_sha256,
    }
    const base = columnDigest({ engine: live, columns: { v: [1] } })
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(live)).toEqual([...ENGINE_FIELDS])
    // moving any one of them moves the digest
    expect(columnDigest({ engine: { ...live, script_engine: live.script_engine + 1 }, columns: { v: [1] } })).not.toBe(base)
  })
})
