// Test / benchmark helpers: a JS encoder of the first-frame seed pack (`UFFSEED1`,
// docs/charts/first-frame-seed-format.md), the server encoder's twin (api/services/ffseed_format.py),
// pinned to it byte for byte by codec.test.js against packs the Python encoder built. Production never
// encodes; the reader is the product.

import { gzipSync } from 'fflate'
import { crc32 } from '../../historyLake/piece'
import { SEED_FIELDS, SEED_TUNIT, SEED_MAGIC } from '../codec'

const zz = (x) => (x >= 0 ? 2 * x : -2 * x - 1)
const POW = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]

function varints(values, out) {
  for (let v of values) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`varint: ${v}`)
    do {
      let b = v % 128
      v = Math.floor(v / 128)
      if (v > 0) b |= 0x80
      out.push(b)
    } while (v > 0)
  }
}

function columnsCrc(cols, n) {
  const buf = new Uint8Array(n * 8)
  const view = new DataView(buf.buffer)
  let crc = 0
  for (const name of ['t', 'o', 'h', 'l', 'c', 'v', 'n']) {
    const col = cols[name]
    for (let i = 0; i < n; i++) {
      const value = col[i]
      const high = Math.floor(value / 4294967296)
      view.setUint32(i * 8, value - high * 4294967296, true)
      view.setUint32(i * 8 + 4, high, true)
    }
    crc = crc32(buf, crc)
  }
  return crc
}

/** The smallest power of ten (<= 1e9) at which every value is an exact integer / scale. */
export function minimalScale(values) {
  for (const s of POW) if (values.every((x) => Math.round(x * s) / s === x)) return s
  throw new Error('no exact scale')
}

const unixOf = (t) => (typeof t === 'string' ? Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10)) / 1000 : t)

/** One symbol's body (format section 4) from served rows [{t,o,h,l,c,v}] (D `t` may be 'YYYY-MM-DD'). */
export function encodeSeedBody(rows, { tunit }) {
  const n = rows.length
  if (!n) throw new Error('no bars')
  const t = rows.map((r) => unixOf(r.t))
  const prices = rows.flatMap((r) => [r.o, r.h, r.l, r.c])
  const pscale = minimalScale(prices)
  const vscale = minimalScale(rows.map((r) => r.v))
  const I = (x, s) => Math.round(x * s)
  const o = rows.map((r) => I(r.o, pscale)), h = rows.map((r) => I(r.h, pscale))
  const l = rows.map((r) => I(r.l, pscale)), c = rows.map((r) => I(r.c, pscale))
  const v = rows.map((r) => I(r.v, vscale)), nn = rows.map(() => 0)
  const T = [], O = [], H = [], L = [], C = [], V = [], VF = []
  let pt = 0, pc = 0
  for (let i = 0; i < n; i++) {
    if ((t[i] - pt) % tunit !== 0 || (i > 0 && t[i] <= pt)) throw new Error('t not on tunit / increasing')
    T.push((t[i] - pt) / tunit)
    O.push(zz(o[i] - pc))
    H.push(zz(h[i] - Math.max(o[i], c[i])))
    L.push(zz(Math.min(o[i], c[i]) - l[i]))
    C.push(zz(c[i] - o[i]))
    V.push(Math.floor(v[i] / vscale)); VF.push(v[i] % vscale)
    pt = t[i]; pc = c[i]
  }
  const out = []
  for (const col of [T, O, H, L, C, V, VF, nn]) varints(col, out)
  return { body: Uint8Array.from(out), crc: columnsCrc({ t, o, h, l, c, v, n: nn }, n), bars: n, first: t[0], last: t[n - 1], pscale, vscale }
}

/** A whole timeframe pack: {SYM: rows} → UFFSEED1 bytes. */
export function seedPackOf(bySym, { tf = 'D', build = '20261119T0131Z', asof = '2026-11-18', comp = 'gzip' } = {}) {
  const tunit = SEED_TUNIT[tf]
  const asofN = Number(asof.replace(/-/g, ''))
  const blobs = []
  const symbols = {}
  let at = 0, depth = 0
  for (const sym of Object.keys(bySym).sort()) {
    const b = encodeSeedBody(bySym[sym], { tunit })
    const blob = comp === 'gzip' ? gzipSync(b.body) : b.body
    symbols[sym] = [at, blob.length, b.bars, b.first, b.last, asofN, b.crc, b.body.length, b.pscale, b.vscale]
    blobs.push(blob)
    at += blob.length
    depth = Math.max(depth, b.bars)
  }
  const tr = { asof, basis: 'served', build, comp, depth, fields: [...SEED_FIELDS], grid: 'rth', kind: 'ffseed', symbols, tf, tunit, v: 1 }
  const trailer = new TextEncoder().encode(JSON.stringify(tr))
  const out = new Uint8Array(at + trailer.length + 16)
  let p = 0
  for (const b of blobs) { out.set(b, p); p += b.length }
  out.set(trailer, p)
  const dv = new DataView(out.buffer)
  dv.setUint32(p + trailer.length, trailer.length, true)
  dv.setUint32(p + trailer.length + 4, 0, true)
  out.set(new TextEncoder().encode(SEED_MAGIC), p + trailer.length + 8)
  return out
}

/** Deterministic synthetic bars: `n` bars from `t0` every `step` s, 4-decimal prices. */
export function synthBars(n, { t0 = 1_794_000_000, step = 300, seed = 1, base = 100 } = {}) {
  let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  const rows = []
  let px = base
  for (let i = 0; i < n; i++) {
    const o = Math.round(px * 10000) / 10000
    const c = Math.round((o * (1 + (rnd() - 0.5) * 0.02)) * 10000) / 10000
    const h = Math.round((Math.max(o, c) * (1 + rnd() * 0.005)) * 10000) / 10000
    const l = Math.round((Math.min(o, c) * (1 - rnd() * 0.005)) * 10000) / 10000
    rows.push({ t: t0 + i * step, o, h, l, c, v: Math.floor(rnd() * 1e6) })
    px = c
  }
  return rows
}
