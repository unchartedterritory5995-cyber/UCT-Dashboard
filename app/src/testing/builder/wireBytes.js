// app/src/testing/builder/wireBytes.js
//
// ─── ⭐ e98 P2 — THE BYTES A MESSAGE COSTS THE PAGE, COUNTED THE SAME ON EVERY NODE ──────────────────────────────────
//
// `memberDoorBytes.test.js` measured `v8.serialize(v).length`, which is the structured-clone wire format of the V8 that
// runs the test. That length moves with the V8 version, not with the message: the same 6 scripts read about 18%
// larger under Node 20 (CI) than under Node 24 (the developer's box). The main cause is how V8 holds a whole number:
// one kept as a double on the heap is written as a 9-byte double, one kept as a small integer as a 2..6-byte varint,
// and which one a value is depends on the engine's optimisations, not on the number.
//
// `wireBytes(v)` counts the SAME wire format (V8's ValueSerializer, format 15: the tags and varints below) by a rule
// that reads only the VALUE, so a message has one size on every Node:
//   - a number that is an int32 is written as `I` + zigzag varint, any other number as `N` + 8 bytes;
//   - a string whose every code unit is below 256 is one-byte (`"` + varint length + bytes), any other is two-byte
//     (`c` + varint byte length + 2 bytes per code unit);
//   - an object or array met again is a back-reference (`^` + varint id), as structured clone writes it;
//   - a plain object is `o`, its keys and values, `{` + varint count; an array without holes is dense (`A` + varint
//     length, elements, `$` + varint 0 + varint length), one with holes sparse (`a`, each (index, value), `@`);
//   - a Map, Set, Date, ArrayBuffer and typed array as structured clone writes them (`B` then `V`). Node's own
//     `v8.serialize` writes a typed array as a Node host object instead, so it reads a few bytes apart there.
// ⛔ A value structured clone cannot carry (a function, a symbol) THROWS here, as `postMessage` does: a message that
// could not be posted has no size.
// It is a measure, not a serializer: nothing is written, only counted.

const varintLen = (n) => {
  let len = 1
  let x = Math.floor(Math.abs(n))
  while (x >= 128) { x = Math.floor(x / 128); len += 1 }
  return len
}
const zigzag = (i) => (i >= 0 ? i * 2 : -i * 2 - 1)
const isInt32 = (n) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647 && !Object.is(n, -0)
const oneByte = (s) => {
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) > 255) return false
  return true
}

/** The bytes of a string as V8 writes it (`"` one-byte, `c` two-byte). */
export function stringBytes(s) {
  if (oneByte(s)) return 1 + varintLen(s.length) + s.length
  return 1 + varintLen(s.length * 2) + s.length * 2
}

/** The bytes of a number (`I` int32 zigzag varint, `N` double). */
export function numberBytes(n) {
  return isInt32(n) ? 1 + varintLen(zigzag(n)) : 9
}

const TYPED = typeof ArrayBuffer !== 'undefined' ? ArrayBuffer : null

/**
 * The structured-clone wire size of `value`, counted by the value's own rule (see the header).
 * @param {*} value
 * @returns {number}
 */
export function wireBytes(value) {
  const seen = new Map()
  let nextId = 0
  const walk = (v) => {
    if (v === undefined) return 1
    if (v === null) return 1
    const t = typeof v
    if (t === 'boolean') return 1
    if (t === 'number') return numberBytes(v)
    if (t === 'string') return stringBytes(v)
    if (t === 'bigint') {
      const hexDigits = (v < 0n ? -v : v).toString(16).length
      const words = Math.max(1, Math.ceil(hexDigits / 16))
      return 1 + varintLen(words * 2) + words * 8
    }
    if (t === 'function' || t === 'symbol') throw new TypeError(`wireBytes: a ${t} cannot be posted`)
    // objects: a second sighting is a back-reference
    if (seen.has(v)) return 1 + varintLen(seen.get(v))
    seen.set(v, nextId)
    nextId += 1
    if (v instanceof Date) return 9
    if (TYPED && v instanceof ArrayBuffer) return 1 + varintLen(v.byteLength) + v.byteLength
    if (TYPED && ArrayBuffer.isView(v)) {
      // the buffer (`B`), then the view (`V`, its kind, offset, length, flags)
      const buf = 1 + varintLen(v.buffer.byteLength) + v.buffer.byteLength
      return buf + 2 + varintLen(v.byteOffset) + varintLen(v.byteLength) + 1
    }
    if (v instanceof Map) {
      let n = 1
      for (const [k, x] of v) n += walk(k) + walk(x)
      return n + 1 + varintLen(v.size * 2)
    }
    if (v instanceof Set) {
      let n = 1
      for (const x of v) n += walk(x)
      return n + 1 + varintLen(v.size)
    }
    if (Array.isArray(v)) {
      let holes = false
      for (let i = 0; i < v.length; i += 1) if (!(i in v)) { holes = true; break }
      if (!holes) {
        let n = 1 + varintLen(v.length)
        for (let i = 0; i < v.length; i += 1) n += walk(v[i])
        return n + 1 + varintLen(0) + varintLen(v.length)
      }
      // a holey array is written sparse: `a` + length, each present (index, value), `@` + count + length
      let n = 1 + varintLen(v.length)
      let count = 0
      for (let i = 0; i < v.length; i += 1) if (i in v) { n += numberBytes(i) + walk(v[i]); count += 1 }
      return n + 1 + varintLen(count) + varintLen(v.length)
    }
    let n = 1
    let count = 0
    for (const k of Object.keys(v)) {
      const x = v[k]
      // ⭐ an own property holding a function is not cloneable: postMessage throws, and so does this
      const idx = /^(0|[1-9]\d*)$/.test(k) && Number(k) <= 4294967294 ? Number(k) : null
      n += (idx === null ? stringBytes(k) : numberBytes(idx)) + walk(x)
      count += 1
    }
    return n + 1 + varintLen(count)
  }
  // the header: 0xFF and the format version (15)
  return 2 + walk(value)
}
