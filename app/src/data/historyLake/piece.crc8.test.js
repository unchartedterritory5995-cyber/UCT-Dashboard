// @vitest-environment node
/**
 * SMOOTHNESS PART 2, ITEM (2a): CRC-32 EIGHT BYTES AT A TIME (2026-11-26).
 *
 * Trace (local dist 4bc325e4ae, 1m+15m board, 5 traced switches): the lake pieces' column CRC (`columnsCrc` -> `crc32`)
 * was 4.5 ms of the ~10 ms a flip their decode took on the main thread. `crc32` now takes eight bytes of a Uint8Array per
 * step (slicing by eight). The CRC is a pure function: the rail is that it is the same CRC.
 *   C1 the check value of '123456789' (0xCBF43926) and zlib's own answers (node:zlib.crc32 where this Node has it)
 *   C2 the same CRC as the byte-at-a-time loop (the code as it was, ed7605b405) for every length 0..300, for seeded
 *      lengths to 200,000, from seeded starting CRCs, over subarrays at odd offsets, and for a plain array of bytes
 *   C3 every piece fixture still decodes (the column CRC is checked against the Python encoder's), covered by piece.test.js
 */
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { crc32 } from './piece'

// the reference: crc32 as it was (ed7605b405)
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c >>> 0
  }
  return t
})()
function refCrc32(bytes, crc = 0) {
  let c = (crc ^ 0xFFFFFFFF) >>> 0
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

let seed = 20261126
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const bytesOf = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b }

describe('crc32, eight bytes at a time', () => {
  it('C1 the check value, and zlib\'s answers', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
    if (typeof zlib.crc32 === 'function') {
      for (const n of [1, 7, 8, 9, 15, 16, 17, 1000, 65537]) {
        const b = bytesOf(n)
        expect([n, crc32(b)]).toEqual([n, zlib.crc32(b)])
        expect([n, 'continued', crc32(b.subarray(3), crc32(b.subarray(0, 3)))]).toEqual([n, 'continued', zlib.crc32(b)])
      }
    }
  })

  it('C2 the same CRC as the byte-at-a-time loop: every length to 300, seeded lengths, starts and offsets, plain arrays', () => {
    for (let n = 0; n <= 300; n++) {
      const b = bytesOf(n)
      const start = n % 3 === 0 ? 0 : Math.floor(rnd() * 4294967296)
      if (crc32(b, start) !== refCrc32(b, start)) expect([n, start, crc32(b, start)]).toEqual([n, start, refCrc32(b, start)])
    }
    for (let k = 0; k < 40; k++) {
      const n = Math.floor(rnd() * 200000)
      const big = bytesOf(n + 13)
      const off = Math.floor(rnd() * 13)
      const view = big.subarray(off, off + n)            // a view at an odd offset of a larger buffer
      const start = Math.floor(rnd() * 4294967296)
      expect([n, off, crc32(view, start)]).toEqual([n, off, refCrc32(view, start)])
    }
    const plain = Array.from(bytesOf(1003))
    expect(crc32(plain)).toBe(refCrc32(plain))
    expect(crc32(plain, 12345)).toBe(refCrc32(plain, 12345))
  })
})
