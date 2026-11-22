// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createSha256, sha256Hex } from './sha256'

const ref = (b) => createHash('sha256').update(b).digest('hex')

describe('streaming sha256', () => {
  it('matches node:crypto on the padding edges and on random data, in any chunking', () => {
    const lens = [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 70_001]
    let seed = 7
    for (const n of lens) {
      const b = new Uint8Array(n)
      for (let i = 0; i < n; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; b[i] = seed >>> 24 }
      expect(sha256Hex(b)).toBe(ref(b))
      // chunked at awkward sizes
      const h = createSha256()
      for (let at = 0, k = 1; at < n; k = (k * 7) % 97 + 1) { h.update(b.subarray(at, Math.min(n, at + k))); at += k }
      expect(h.hex()).toBe(ref(b))
      expect(h.length).toBe(n)
    }
  })
  it('the known vector', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
