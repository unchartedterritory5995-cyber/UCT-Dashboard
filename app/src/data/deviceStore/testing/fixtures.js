// Test / benchmark helpers: encode bars into the device store's record codecs and packs (the seed
// builder's half). Production never encodes; the decoders are the product.

import { crc32 } from '../../historyLake/piece'
import { encodePack } from '../codec'

const zz = (x) => (x >= 0 ? 2 * x : -2 * x - 1)

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

const exact = (x, scale, what) => {
  const r = Math.round(x * scale)
  if (r / scale !== x) throw new Error(`${what} ${x} is not exact at scale ${scale}`)
  return r
}

/**
 * A 'ubh1' record (FORMAT.md §3 with a RAW body) from bars [{t,o,h,l,c,v,n?}] (t unix seconds,
 * prices / volume as doubles). Returns {bytes, bars, first, last, crc, body}.
 */
export function encodeUbhRecord(rows, { symbol = 'X', series = 'D', tunit = 60, pscale = 10000, vscale = 1 } = {}) {
  const n = rows.length
  if (!n) throw new Error('no bars')
  const t = rows.map((r) => r.t)
  const o = rows.map((r) => exact(r.o, pscale, 'o')), h = rows.map((r) => exact(r.h, pscale, 'h'))
  const l = rows.map((r) => exact(r.l, pscale, 'l')), c = rows.map((r) => exact(r.c, pscale, 'c'))
  const v = rows.map((r) => exact(r.v, vscale, 'v')), nn = rows.map((r) => r.n ?? 0)
  const T = [], O = [], H = [], L = [], C = [], V = [], VF = []
  let pt = 0, pc = 0
  for (let i = 0; i < n; i++) {
    if ((t[i] - pt) % tunit !== 0 || t[i] <= pt && i > 0) throw new Error('t not on tunit / increasing')
    T.push((t[i] - pt) / tunit)
    O.push(zz(o[i] - pc))
    H.push(zz(h[i] - Math.max(o[i], c[i])))
    L.push(zz(Math.min(o[i], c[i]) - l[i]))
    C.push(zz(c[i] - o[i]))
    V.push(Math.floor(v[i] / vscale)); VF.push(v[i] % vscale)
    pt = t[i]; pc = c[i]
  }
  const bodyArr = []
  for (const col of [T, O, H, L, C, V, VF, nn]) varints(col, bodyArr)
  const body = Uint8Array.from(bodyArr)
  const crc = columnsCrc({ t, o, h, l, c, v, n: nn }, n)
  const header = { bars: n, basis: 'raw', body: body.length, crc, first: t[0], last: t[n - 1], period: 'seed',
    pscale, series, symbol, tunit, v: 1, vscale }
  const hjson = new TextEncoder().encode(JSON.stringify(header))
  const prefix = new Uint8Array(6 + hjson.length)
  prefix.set([0x55, 0x42, 0x48, 1, hjson.length & 255, hjson.length >> 8], 0)
  prefix.set(hjson, 6)
  const hcrc = crc32(prefix)
  const out = new Uint8Array(prefix.length + 4 + body.length)
  out.set(prefix, 0)
  new DataView(out.buffer).setUint32(prefix.length, hcrc, true)
  out.set(body, prefix.length + 4)
  return { bytes: out, bars: n, first: t[0], last: t[n - 1], crc, body }
}

/** An 'f64' record. */
export function encodeF64Record(rows) {
  const n = rows.length
  const out = new Uint8Array(12 + n * 48)
  const dv = new DataView(out.buffer)
  out.set([0x46, 0x36, 0x34, 0x43], 0)
  dv.setUint32(4, n, true)
  let at = 12
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) for (let i = 0; i < n; i++, at += 8) dv.setFloat64(at, rows[i][k], true)
  return { bytes: out, bars: n, first: rows[0].t, last: rows[n - 1].t }
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

/** A whole timeframe pack: {SYM: rows} → bytes. */
export function packOf(bySym, { codec = 'ubh1', series = 'D', tunit = 60, build = null } = {}) {
  const recs = Object.entries(bySym).map(([sym, rows]) => ({
    sym, ...(codec === 'f64' ? encodeF64Record(rows) : encodeUbhRecord(rows, { symbol: sym, series, tunit })),
  }))
  return encodePack(recs, { series, codec, build })
}
