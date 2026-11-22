// app/src/components/chart/builder/memberPane/storedBytes.js
//
// ─── ⭐ ENGINE 53 — THE BYTES THE STORE WILL COUNT, COUNTED BEFORE A RUN HALF IS MINTED ──
//
// A run half re-embeds the whole script (`compute.runtimeObjects.source`), so a document can
// cross the store's 64 KiB cap (`user_definitions.MAX_DEFINITION_BYTES`) because of it. The
// door must never mint a run half that then fails to save, so it measures what the store
// measures, in the store's own way:
//   1. the save adds the engine stamp (`withEngineStamp`, the script door's save) and sends the
//      graph form when the inlined one would not fit (`useUserDefinitions.saveUserDefinition`
//      -> `reduceIfOversized`) — `sentDocument`;
//   2. the store keeps a graph document without its materialised forest
//      (`user_definitions.normalize_graph_document`: `ast`, `trees`, `source`, `sources`
//      dropped) and without `meta.semantics` (`_without_semantics`), and counts
//      `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)` in UTF-8 —
//      `storeBytes`, which formats every value the way Python's `json` does (a float below
//      1e-4 is `1e-05`, not `0.00001`; an escape is the one Python writes).
// The server's own count of the same sent document is `user_definitions.stored_bytes_for_new`;
// one fixture both suites read holds the two equal (`tests/fixtures/run_half_stored_bytes.json`).
import { reduceIfOversized } from '../../engine/ast/graphDocument'
import { withEngineStamp } from '../../engine/scriptEngineVersion'
import { reconcileParams, CONFLICTED } from '../paramEdit'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The document as the script door's save sends it. */
export function sentDocument(definition) {
  return reduceIfOversized(withEngineStamp(definition))
}

/** Python's `repr(float)` length for a non-integral finite number. */
function pyFloatText(n) {
  // the decimal exponent of the shortest round-trip digits (the ones both languages print)
  const [mant, e] = n.toExponential().split('e')
  const exp = Number(e)
  if (exp >= -4) return String(n)
  // Python writes the shortest digits in scientific form below 1e-4, exponent at least 2 digits
  const ev = Math.abs(exp)
  return `${mant}e-${ev < 10 ? `0${ev}` : ev}`
}

function utf8Len(s) {
  let n = 0
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i += 1 }
    else n += 3
  }
  return n
}

/** Bytes of a JSON string literal as Python's `json.dumps(ensure_ascii=False)` writes it. */
function pyStringBytes(s) {
  let n = 2
  let plain = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (ch === '"' || ch === '\\' || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x08 || c === 0x0c) n += 2
    else if (c < 0x20) n += 6
    else plain += ch
  }
  return n + utf8Len(plain)
}

/** Bytes of `value` as the store serialises it (only what `JSON.stringify` would send). */
export function pyJsonBytes(value) {
  if (value === null) return 4
  if (value === true) return 4
  if (value === false) return 5
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 4 // JSON.stringify sends null
    return Number.isInteger(value) ? String(value).length : pyFloatText(value).length
  }
  if (typeof value === 'string') return pyStringBytes(value)
  if (Array.isArray(value)) {
    let n = 2
    value.forEach((v, i) => {
      n += (i ? 1 : 0) + (v === undefined || typeof v === 'function' ? 4 : pyJsonBytes(v))
    })
    return n
  }
  if (isObj(value)) {
    let n = 2
    let first = true
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || typeof v === 'function') continue
      n += (first ? 0 : 1) + pyStringBytes(k) + 1 + pyJsonBytes(v)
      first = false
    }
    return n
  }
  return 4
}

/** The `compute.paramState` the store writes beside a parameter roster
 *  (`param_manifest.apply` -> `reconcile`; `paramEdit.reconcileParams` is its mirror), with a
 *  conflicted reason worded as Python formats its list. */
function serverParamState(definition) {
  const manifest = definition && definition.compute && definition.compute.paramManifest
  if (!isObj(manifest)) return null
  const state = reconcileParams(definition)
  for (const s of Object.values(state)) {
    if (s && s.state === CONFLICTED && typeof s.reason === 'string') s.reason = s.reason.replace(/disagree \(([^)]*)\)/, 'disagree ([$1])')
  }
  return state
}

/** The bytes the store counts for a SENT document (`sentDocument`). `paramState`: the state
 *  the store will write beside the roster (read off `sent` itself unless given, which a graph
 *  document, whose trees the store materialises, needs). */
export function storeBytes(sent, paramState = serverParamState(sent)) {
  let d = sent
  if (paramState && isObj(d) && isObj(d.compute)) d = { ...d, compute: { ...d.compute, paramState } }
  if (isObj(d) && isObj(d.compute) && 'graph' in d.compute) {
    const c = { ...d.compute }
    for (const k of ['ast', 'trees', 'source', 'sources']) delete c[k]
    d = { ...d, compute: c }
  }
  if (isObj(d) && isObj(d.meta) && 'semantics' in d.meta) {
    const meta = { ...d.meta }
    delete meta.semantics
    d = { ...d, meta }
  }
  return pyJsonBytes(d)
}

/** The bytes the store will count for `definition` saved from the script door. */
export const storedBytesOf = (definition) => storeBytes(sentDocument(definition), serverParamState(definition))
