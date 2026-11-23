// Test-only: writes universe minute frames (UMF1) for a fake clock, so a rail can publish "the minute that just
// closed" for symbols and times of its own. Never imported by product code.
//
// ⛔ NOT A SECOND ENCODER OF THE FORMAT. The format is defined and encoded by api/services/minute_frames.py; the
// browser's only reader is codec.js. This writes the simplest legal spelling of it (every price and volume as a raw
// float64: the format's RAW_SCALE escape), and frameWriter.test.js holds it to the real decoder, record for record.

import { crc32, MAGIC, VERSION, FLAG_INCOMPLETE, NO_SEQ, RAW_SCALE, KIND_ONTIME, SESSION_START_MIN } from '../codec'
import { etMinuteOfDay, etDateLabel } from '../../../components/chart/barTime'

function varint(out, n) {
  let v = n
  while (v >= 128) { out.push((v % 128) | 0x80); v = Math.floor(v / 128) }
  out.push(v)
}

function f64(out, x) {
  const b = new Uint8Array(new Float64Array([x]).buffer)      // little-endian on every platform the tests run on
  for (const y of b) out.push(y)
}

function u32(out, n) { out.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, Math.floor(n / 16777216) & 255) }

/**
 * One frame's raw bytes.
 * @param {object} o
 * @param {number} o.minute            unix minute of the frame's own minute
 * @param {number} [o.prevSeq]         the seq published before it (default: seq - 1; NO_SEQ for an epoch's first)
 * @param {number} [o.epoch]
 * @param {boolean} [o.incomplete]     FLAG_INCOMPLETE
 * @param {Array<{minute?:number, kind?:number, rows:Array<{sym:string,o:number,h:number,l:number,c:number,v:number}>}>} o.blocks
 *        (a block's `minute` defaults to the frame's, its `kind` to ONTIME)
 */
export function writeFrame({ minute, prevSeq, epoch = 7, incomplete = false, blocks = [] }) {
  const sec = minute * 60
  const seq = etMinuteOfDay(sec) - SESSION_START_MIN
  const day = Number(etDateLabel(sec).replace(/-/g, ''))
  const symbols = [...new Set(blocks.flatMap((b) => b.rows.map((r) => r.sym)))].sort()
  const index = new Map(symbols.map((s, i) => [s, i]))
  const out = []
  for (const ch of MAGIC) out.push(ch.charCodeAt(0))
  out.push(VERSION, incomplete ? FLAG_INCOMPLETE : 0, 0, 0)
  u32(out, day); u32(out, seq); u32(out, prevSeq ?? (seq > 0 ? seq - 1 : NO_SEQ)); u32(out, epoch); u32(out, minute)
  varint(out, symbols.length)
  for (const s of symbols) { out.push(0, s.length); for (const ch of s) out.push(ch.charCodeAt(0)) }   // no front coding
  varint(out, blocks.length)
  for (const b of blocks) {
    varint(out, b.minute ?? minute)
    out.push(b.kind ?? KIND_ONTIME)
    const rows = [...b.rows].sort((x, y) => index.get(x.sym) - index.get(y.sym))
    varint(out, rows.length)
    let prev = -1
    for (const r of rows) {
      const i = index.get(r.sym)
      varint(out, i - prev - 1)
      prev = i
      out.push((RAW_SCALE << 4) | RAW_SCALE)
      f64(out, r.o); f64(out, r.h); f64(out, r.l); f64(out, r.c); f64(out, r.v)
    }
  }
  const body = Uint8Array.from(out)
  const frame = new Uint8Array(body.length + 4)
  frame.set(body)
  const crc = crc32(body)
  frame[body.length] = crc & 255; frame[body.length + 1] = (crc >>> 8) & 255
  frame[body.length + 2] = (crc >>> 16) & 255; frame[body.length + 3] = (crc >>> 24) & 255
  return frame
}

/** `{YYYY-MM-DD}/{HHMM}.bin` of a unix minute: the path the consumer asks the edge for. */
export function framePath(minute) {
  const sec = minute * 60
  const mod = etMinuteOfDay(sec)
  return `${etDateLabel(sec)}/${String(Math.floor(mod / 60)).padStart(2, '0')}${String(mod % 60).padStart(2, '0')}.bin`
}

/** A fetch Response-like answer the consumer reads (`ok`, `status`, `arrayBuffer`). */
export function frameResponse(bytes) {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}
export function statusResponse(status) {
  return { ok: false, status, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ error: 'no' }) }
}
