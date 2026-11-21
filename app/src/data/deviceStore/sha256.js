// app/src/data/deviceStore/sha256.js — streaming SHA-256 (FIPS 180-4), pure JS.
//
// WebCrypto's digest() takes ONE buffer: hashing a 60 MB timeframe file with it means holding all of
// it in memory, and a resumed download would have to read the whole partial file back into one
// buffer first. This hashes chunk by chunk as the bytes arrive (and, on a resume, as the partial file
// is read back), so the ingest never holds more than one chunk. Pinned against node:crypto by
// sha256.test.js.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** A streaming hasher: `update(bytes)` any number of times, then `hex()` once. */
export function createSha256() {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const W = new Uint32Array(64)
  const block = new Uint8Array(64)
  let fill = 0          // bytes held in `block`
  let total = 0         // bytes hashed so far (a Number: exact far past any file this hashes)
  let done = false

  function compress(b, off) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      W[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15], w2 = W[i - 2]
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
    }
    let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & bb) ^ (a & c) ^ (bb & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0
      d = c; c = bb; bb = a; a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
  }

  return {
    update(bytes) {
      if (done) throw new Error('sha256: update after hex()')
      let i = 0
      const n = bytes.length
      total += n
      if (fill) {
        const take = Math.min(64 - fill, n)
        block.set(bytes.subarray(0, take), fill)
        fill += take
        i = take
        if (fill < 64) return this
        compress(block, 0)
        fill = 0
      }
      for (; i + 64 <= n; i += 64) compress(bytes, i)
      if (i < n) { block.set(bytes.subarray(i), 0); fill = n - i }
      return this
    },
    /** Bytes hashed so far. */
    get length() { return total },
    hex() {
      if (!done) {
        done = true
        const bits = total * 8
        block[fill++] = 0x80
        if (fill > 56) { block.fill(0, fill); compress(block, 0); fill = 0 }
        block.fill(0, fill, 56)
        const hi = Math.floor(bits / 4294967296)
        const lo = bits >>> 0
        block[56] = hi >>> 24; block[57] = (hi >>> 16) & 255; block[58] = (hi >>> 8) & 255; block[59] = hi & 255
        block[60] = lo >>> 24; block[61] = (lo >>> 16) & 255; block[62] = (lo >>> 8) & 255; block[63] = lo & 255
        compress(block, 0)
      }
      let out = ''
      for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0')
      return out
    },
  }
}

/** SHA-256 of one buffer, hex. */
export function sha256Hex(bytes) {
  return createSha256().update(bytes).hex()
}
