// app/src/components/chart/engine/pineRuntimeHandle.js
//
// ─── THE COMPUTE HANDLE OF A RUNTIME-LANE (`compute.kind: 'pine'`) DOCUMENT ──
//
// A runtime-lane document stores the member's Pine and the map from each plot
// key to the runtime output it reads (`pineRuntimeLane.js` says why). Its
// `compute.fn` is `pine:<FNV-1a>` over those parts, so a changed script or a
// changed map is a changed handle.
//
// ⛔⛔ THE TEXT HASHED IS KEY-ORDER-INDEPENDENT, AND THAT IS WHAT LETS THE
// DOCUMENT ROUND-TRIP THE STORE. `api/services/user_definitions.py` re-derives
// this handle on every save and refuses a document whose `fn` disagrees — and the
// store persists every blob with SORTED keys. A handle over `JSON.stringify` in
// insertion order (what this was on 2026-09-27) is a different string once the
// document has been stored and read back: `columns` comes back `out10, out2, …,
// value` and each spec comes back `call, line, output, shift`. A member re-saving
// a stored runtime document would then be refused for a hash mismatch nothing
// had caused. So both lanes hash `canonicalJson`: keys sorted at every level, no
// whitespace. The server's mirror is `user_definitions.runtime_lane_handle`, and
// the two are held to ONE committed vector table
// (`tests/fixtures/pine_store/handle_vectors.json`) from both sides.
//
// ⚠️ PURE, AND IMPORTS NOTHING, on purpose: the parity rails read it without
// pulling the runtime lane's VM into a test that only needs a hash.

/** FNV-1a (32-bit) of a string's UTF-16 code units, as 8 hex digits, prefixed
 *  `pine:`. */
export function runtimeLaneHandle(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `pine:${h.toString(16).padStart(8, '0')}`
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Canonical JSON: object keys SORTED at every level, no whitespace; arrays keep
 *  their order. An `undefined` property is skipped (as `JSON.stringify` skips
 *  it). ⛔ A non-integral or non-finite number THROWS: the two lanes format those
 *  differently (`1e-7` vs `1e-07`, `NaN` vs `null`), and every number in a
 *  runtime document's handle is an output index, a line or a shift — integers. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`canonicalJson: ${value} is not an integer; a runtime handle hashes integers only`)
  }
  if (value === undefined) return 'null'
  return JSON.stringify(value)
}

/** The handle a runtime-lane `compute` must carry as its `fn`. */
export function runtimeLaneHandleOf(compute) {
  const c = isPlainObject(compute) ? compute : {}
  const lane = isPlainObject(c.lane) ? c.lane : {}
  return runtimeLaneHandle(canonicalJson([
    typeof c.source === 'string' ? c.source : '',
    isPlainObject(c.columns) ? c.columns : {},
    isPlainObject(c.inputs) ? c.inputs : {},
    lane.plotColours === true,
    lane.ownsDrawing === true,
  ]))
}
