// app/src/components/chart/engine/runHalfProgram.js
//
// ─── ⭐⭐ ENGINE 54 — A RUN HALF IS BOUND TO THE PROGRAM IT WAS MINTED BESIDE ─────────────
//
// Engine 53 bound a run half to its document's SCRIPT (`meta.pineSourceSha256`: the bind runs
// `compute.runtimeObjects.source` only when it hashes to the stamp, and the store saves the row
// only when the stamp, the run half's source and the row's own `pine_source` are one script).
// It did not bind the document's TREES and OBJECT PROGRAM to that script: a row could carry
// script A's run half beside plots and drawings edited by hand, and the column and object
// rails would compare the run against whatever the row now says.
//
// So the member door stamps a DIGEST OF THE TRANSLATED PROGRAM it minted the run half beside
// (`compute.runtimeObjects.programSha256`, and `programGraphSha256` when the store will keep
// the document in its graph form), and the bind re-derives it from the document in hand and
// refuses (`run-half:program-unbound`) on any difference: an edited tree, an edited object
// program, an edited output map or site map, another script.
//
// What it covers, form by form (the form the store keeps is the form the bind reads):
//   trees form   compute.ast, compute.trees, compute.scanPlot, definition.objects
//   graph form   compute.graph, compute.scanPlot, definition.objects (bound to the graph)
// plus, in both, the run half's own `outputs` and `sites` and the sha256 of its `source`.
// The store drops `ast` / `trees` / `source(s)` from a graph document and the client
// re-materialises them (`graphDocument.hydrateGraphDocument`), so a graph document is checked
// on its graph, never on the derived forest.
//
// ⛔ WHAT IT IS NOT, stated: a digest the client computes can be recomputed by anyone who
// edits the row. It makes an edit that keeps the old stamp fail, and it makes the run half's
// program, plots and objects one recorded unit; it does not prove the trees were translated
// from the script. That needs the server to translate, which it cannot today (EVIDENCE,
// engine 54: the translator's door, `memberPaneDefinition`, is not in the pine-runtime
// service's closure). The object rail (`runHalfObjectRail.js`) is what keeps a wrong drawing
// off the chart either way: the run's objects must equal the host's on every comparable site.
//
// ⛔ THIS MODULE IMPORTS ONLY THE HASH. `nativeRegistry` reads it on every bind, and must not
// pull the translator (`graphDocument` -> `pine.js`) into the chart's bundle.
import { sha256Hex } from './ast/parse.js'

/** The two stamp fields on `compute.runtimeObjects`. */
export const RUN_HALF_PROGRAM_STAMP = 'programSha256'
export const RUN_HALF_PROGRAM_GRAPH_STAMP = 'programGraphSha256'

/** The digest format's version (bumped only when what is hashed changes). */
const DIGEST_VERSION = 1

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** JSON with every object's keys sorted, values as `JSON.stringify` writes them (a non-finite
 *  number is `null`, `undefined` and functions are left out, as JSON leaves them out). */
export function canonicalJson(value) {
  if (value === undefined || typeof value === 'function') return undefined
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => { const c = canonicalJson(v); return c === undefined ? 'null' : c }).join(',')}]`
  }
  if (typeof value.toJSON === 'function') return canonicalJson(value.toJSON())
  const parts = []
  for (const k of Object.keys(value).sort()) {
    const c = canonicalJson(value[k])
    if (c !== undefined) parts.push(`${JSON.stringify(k)}:${c}`)
  }
  return `{${parts.join(',')}}`
}

/** Is this document in its graph form (the form the bind reads it in)? */
export function isGraphForm(definition) {
  const c = definition && definition.compute
  return !!(isObj(c) && isObj(c.graph) && Array.isArray(c.graph.nodes))
}

/** The digest of the program a run half rides beside, in the document's own form.
 *  @param {object} definition an `ast` document carrying `compute.runtimeObjects`
 *  @returns {string|null} 64 lowercase hex, or null when the document carries no run half */
export function runHalfProgramDigest(definition) {
  const c = definition && definition.compute
  const ro = c && c.runtimeObjects
  if (!isObj(c) || !isObj(ro) || typeof ro.source !== 'string') return null
  const graph = isGraphForm(definition)
  const payload = {
    v: DIGEST_VERSION,
    form: graph ? 'graph' : 'trees',
    source: sha256Hex(ro.source),
    outputs: isObj(ro.outputs) ? ro.outputs : null,
    sites: isObj(ro.sites) ? ro.sites : null,
    scanPlot: c.scanPlot === undefined ? null : c.scanPlot,
    objects: definition.objects === undefined ? null : definition.objects,
    ...(graph ? { graph: c.graph } : { ast: c.ast === undefined ? null : c.ast, trees: c.trees === undefined ? null : c.trees }),
  }
  return sha256Hex(canonicalJson(payload))
}

/** The stamp field the bind compares, for this document's form. */
export function runHalfProgramStampKey(definition) {
  return isGraphForm(definition) ? RUN_HALF_PROGRAM_GRAPH_STAMP : RUN_HALF_PROGRAM_STAMP
}

const _verdicts = new WeakMap()
/** ⭐ The bind's question: does this document's program still digest to the stamp its door
 *  wrote for its form? Memoised per document object (a document is installed frozen).
 *  @returns {boolean} */
export function runHalfProgramBound(definition) {
  if (!definition || typeof definition !== 'object') return false
  if (_verdicts.has(definition)) return _verdicts.get(definition)
  const ro = definition.compute && definition.compute.runtimeObjects
  const want = isObj(ro) ? ro[runHalfProgramStampKey(definition)] : null
  const ok = typeof want === 'string' && /^[0-9a-f]{64}$/.test(want) && runHalfProgramDigest(definition) === want
  _verdicts.set(definition, ok)
  return ok
}
