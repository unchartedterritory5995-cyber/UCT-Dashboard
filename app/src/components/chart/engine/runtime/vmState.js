// app/src/components/chart/engine/runtime/vmState.js
//
// ⭐⭐ UIE PHASE 3 (M1) — THE CANONICAL STATE OF A RUN BETWEEN TWO BARS, FLAT.
//
// The warm-up curtain (`runtimeColumns.js::computeOffListing`) runs a script twice,
// from two different first bars. Once the two runs hold the SAME state at the end of
// the same chart bar, and every value either will read from then on is the same
// value, everything they do from then on is the same — so the second run can stop.
// This module answers only the first half of that: "is the state the same?",
// EXACTLY (`Object.is`, so `NaN` equals `NaN` and `-0` does not equal `0`), never to
// a tolerance — two states that differ by one ulp can branch apart later.
//
// What a run carries from one bar to the next, and so what is encoded (`vm.js`):
//   * `persist` and `initialised` — every `var`, the main frame's and each call site's;
//   * the history rings, read LOGICALLY (offset 1..depth back), not by cell: two runs
//     that committed a different number of bars hold the same past in different cells;
//   * `held` — what each call site will commit (P7.2);
//   * the carried-state stores of builtins (`carState`, `car2State`);
//   * the finite-observation windows of `skip` reducers (`winObs`, `winObsN`).
// The bar frame (`locals`), the stack and the scratch windows are reset or refilled
// every bar and carry nothing. A program that draws (an object store) is not encoded:
// the caller does not probe one (`vm.js` refuses to).
//
// ⭐ VALUES BY STRUCTURE, ALIASING INCLUDED. An array or a record is encoded by its
// contents the first time it is reached and by its visit number after that, so two
// slots that share ONE array encode differently from two slots holding two equal
// arrays — a write through one is seen through the other in the first case only.
// ⛔ Anything this does not know how to encode (a drawing handle, an unknown object)
// makes the whole state unencodable (`null`): no probe is answered from a guess.

const ARR = Object.freeze({ mark: 'array' })
const REC = Object.freeze({ mark: 'record' })
const REF = Object.freeze({ mark: 'ref' })
const SLICED = Object.freeze({ mark: 'sliced' })
const PLAIN = Object.freeze({ mark: 'plain' })
const SECTION = Object.freeze({ mark: 'section' })

const RECORD_TAG = Symbol.for('uct.pine.udtRecord')
const HANDLE_TAG = Symbol.for('uct.pine.drawingHandle')

/** The most cells one encoded state may hold; past it the state is not encoded. */
export const STATE_CELL_CAP = 65536

/**
 * Encode the parts of a run's state into one flat array, or `null` when a value
 * cannot be encoded or the state is larger than `cap` cells.
 * @param {Array<ArrayLike<any>>} parts  each a list of values, encoded in order
 * @param {number} [cap]
 */
export function encodeState(parts, cap = STATE_CELL_CAP) {
  const out = []
  const seen = new Map()
  let ok = true
  const put = (v) => {
    if (!ok) return
    if (out.length >= cap) { ok = false; return }
    if (v === null || typeof v !== 'object') { out.push(v); return }
    if (seen.has(v)) { out.push(REF, seen.get(v)); return }
    if (v[HANDLE_TAG] === true) { ok = false; return }
    seen.set(v, seen.size)
    if (Array.isArray(v)) {
      // a slice's link (`collections.js`, C18) changes what a later write does
      const sliced = Object.getOwnPropertySymbols(v).some((s) => s.description === 'uct.array.sliced' && v[s])
      out.push(ARR, v.length)
      if (sliced) out.push(SLICED)
      for (let i = 0; i < v.length && ok; i += 1) put(v[i])
      return
    }
    if (v[RECORD_TAG] === true) {
      const names = Object.keys(v.f)
      out.push(REC, v.type, names.length)
      for (const name of names) { if (!ok) return; out.push(name); put(v.f[name]) }
      return
    }
    if (ArrayBuffer.isView(v)) {
      out.push(PLAIN, v.length)
      for (let i = 0; i < v.length && ok; i += 1) put(v[i])
      return
    }
    ok = false
  }
  for (const part of parts) {
    if (!ok) break
    out.push(SECTION, part.length)
    for (let i = 0; i < part.length && ok; i += 1) put(part[i])
  }
  return ok ? out : null
}

/** Two encoded states are the same state: cell for cell, `Object.is`. */
export function sameState(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
  return true
}

/**
 * ⭐⭐ UIE PHASE 5 (M2) — A DEEP COPY OF A RUN'S VALUES, ALIASING KEPT.
 *
 * A checkpoint (`vm.js`, `opts.checkpointAt`) must not share a mutable value with the
 * run that goes on after it: `array.push` on the live run would otherwise write into
 * the saved state. One copy per distinct object, so two slots that held ONE array hold
 * one (new) array. Arrays keep their symbol-keyed marks (an `array.slice` link); a UDT
 * record is rebuilt with its tag (frozen wrapper, fresh fields); a typed array is
 * copied. ⭐ Frozen values are shared, not copied: a drawing handle (its identity is the
 * object store's key), an unmeasured-fill marker, a colour — nothing can write them.
 * ⛔ An object of a shape this does not know throws: a checkpoint is exact or absent.
 * @param {Array<ArrayLike<any>>} parts
 * @returns {any[][]} one copied array per part, in order
 */
export function cloneValues(parts) {
  const seen = new Map()
  const copy = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (Object.isFrozen(v) && v[RECORD_TAG] !== true) return v
    if (seen.has(v)) return seen.get(v)
    if (Array.isArray(v)) {
      const out = new Array(v.length)
      seen.set(v, out)
      for (const s of Object.getOwnPropertySymbols(v)) out[s] = v[s]
      for (let i = 0; i < v.length; i += 1) out[i] = copy(v[i])
      return out
    }
    if (v[RECORD_TAG] === true) {
      const f = {}
      const out = Object.freeze({ [RECORD_TAG]: true, type: v.type, f })
      seen.set(v, out)
      for (const k of Object.keys(v.f)) f[k] = copy(v.f[k])
      return out
    }
    if (ArrayBuffer.isView(v)) { const out = v.slice(); seen.set(v, out); return out }
    throw new Error('cloneValues: a value of an unknown shape cannot be checkpointed')
  }
  return parts.map((part) => Array.from(part, copy))
}
