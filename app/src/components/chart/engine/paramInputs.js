// app/src/components/chart/engine/paramInputs.js
//
// ─── ⭐⭐ SETTINGS PARITY (2a): A FOLDED PARAMETER IS A CHART SETTING ─────────────
//
// TradingView lets a member change a script's length on the chart, per chart. A Pine
// translation here folds a length into its tree as a LITERAL (a window must be a plain
// whole number before the tree runs, so `maxLookback` and the repaint verdict stay
// static), and records where (`compute.paramManifest`: per parameter, the `{treeIndex,
// astPath}` of every literal it became). Until this module the only way to change one
// was the Builder's parameter control, which writes a NEW revision of the definition:
// a different indicator, not a setting of this one (ruling R-H named "inputs as runtime
// parameters" as the next wave).
//
// So, two halves, both pure:
//   * `paramInputSpecs` / `withParamInputs`: every ATTACHED parameter (every locator
//     resolves to a plain number, and they agree) is declared as an ordinary `int` /
//     `float` input of the in-memory definition, keyed `param<N>` (KEY_RE needs a
//     letter first; `__uct_param_<N>` would not pass), labelled with the author's
//     title and bounded by the author's minval / maxval / step. The settings dialog,
//     the instance validator and the alert payload then treat it as any input.
//     `fromParam` names the parameter it stands for. ⛔ NEVER SAVED: the projection is
//     applied on load (`memberDocumentMigration.js`), and `stripParamInputs` takes it
//     off any document that is written back.
//   * `specializeParams`: the definition a chart computes for ONE instance's values:
//     each parameter whose value differs from its default is written into every one
//     of its literals (copy-on-write, the same locators `paramEdit.applyParamEdit`
//     writes). Memoised per definition and per value set, so a settings change
//     recomputes only that pane, once.
//
// ⛔ A VALUE THE DOOR WOULD REFUSE IS REFUSED BY NAME. The instance validator already
// refuses a value outside the declared min / max / int-ness (`checkInstanceInput`);
// `specializeParams` re-checks the same rules (a stored instance can predate a bound)
// and answers `{refused}` instead of computing a tree nobody can vouch for.
//
// ⭐ SERVER TWIN: `api/services/param_inputs.py` (the alert, scan and backtest lanes
// evaluate the same specialised trees), held equal by
// `tests/fixtures/ast/param_inputs_parity.json`, which both suites read.

import { getTree, readAt, literalValueOf } from './paramLiteral.js'

export const PARAM_ID_PREFIX = '__uct_param_'
export const PARAM_INPUT_PREFIX = 'param'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The input key a parameter id is declared under (`__uct_param_1003` -> `param1003`). */
export function paramInputKey(paramId) {
  const id = String(paramId)
  return id.startsWith(PARAM_ID_PREFIX) ? `${PARAM_INPUT_PREFIX}${id.slice(PARAM_ID_PREFIX.length)}` : null
}

/** The one value every locator of a manifest entry reads, or null (detached, not a plain
 *  number, or the locators disagree: then it is not offered as a setting). */
export function attachedValue(def, entry) {
  const locators = Array.isArray(entry && entry.locators) ? entry.locators : []
  if (!locators.length) return null
  let value = null
  for (const loc of locators) {
    const tree = getTree(def, loc.treeIndex === undefined ? null : loc.treeIndex)
    const node = tree === undefined ? undefined : readAt(tree, Array.isArray(loc.astPath) ? loc.astPath : [])
    const v = literalValueOf(node)
    if (v === null) return null
    if (value === null) value = v
    else if (!Object.is(value, v)) return null
  }
  return value
}

const specsMemo = new WeakMap()

/** The settings a definition's attached parameters become, in manifest order. */
export function paramInputSpecs(def) {
  if (!isObj(def) || !isObj(def.compute) || def.compute.kind !== 'ast') return []
  const manifest = def.compute.paramManifest
  if (!isObj(manifest)) return []
  const hit = specsMemo.get(def)
  if (hit) return hit
  // the author's own inputs (a projected `param<N>` is this function's own answer, not a collision)
  const taken = new Set((Array.isArray(def.inputs) ? def.inputs : []).filter((i) => i && !i.fromParam).map((i) => i && i.key))
  const out = []
  for (const [id, entry] of Object.entries(manifest)) {
    if (!isObj(entry) || (entry.type !== 'int' && entry.type !== 'float')) continue
    const key = paramInputKey(id)
    if (!key || taken.has(key)) continue
    const value = attachedValue(def, entry)
    if (value === null) continue
    if (entry.type === 'int' && !Number.isInteger(value)) continue
    const spec = { key, label: typeof entry.title === 'string' && entry.title ? entry.title : key, type: entry.type, default: value, fromParam: id }
    for (const k of ['min', 'max', 'step']) if (typeof entry[k] === 'number' && Number.isFinite(entry[k])) spec[k] = entry[k]
    out.push(spec)
  }
  specsMemo.set(def, out)
  return out
}

/** The definition with its attached parameters declared as inputs (unchanged when none). */
export function withParamInputs(def) {
  const specs = paramInputSpecs(def)
  if (!specs.length) return def
  if ((def.inputs || []).some((i) => i && i.fromParam)) return def
  return { ...def, inputs: [...(Array.isArray(def.inputs) ? def.inputs : []), ...specs] }
}

/** A definition with EVERY load-time projected input taken off (a `param<N>`, and since 2c a
 *  run half's own setting, `fromRunHalf`: `runHalfInputs.js`; a symbol setting, `fromSymbol`; and a
 *  runtime document's timeframe setting, `fromTimeframe`: `runtime/runtimeInputs.js`), for anything
 *  written back. */
export function stripParamInputs(def) {
  const projected = (i) => !!(i && (i.fromParam || i.fromRunHalf || i.fromSymbol || i.fromTimeframe))
  if (!isObj(def) || !Array.isArray(def.inputs) || !def.inputs.some(projected)) return def
  return { ...def, inputs: def.inputs.filter((i) => !projected(i)) }
}

/** Why a value cannot be computed for a parameter setting, or null. The instance
 *  validator's rules, re-checked (a stored instance can predate a bound). */
export function paramValueRefusal(spec, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${spec.label} must be a number`
  if (spec.type === 'int' && !Number.isInteger(value)) return `${spec.label} must be a whole number`
  if (typeof spec.min === 'number' && value < spec.min) return `${spec.label} must be at least ${spec.min}`
  if (typeof spec.max === 'number' && value > spec.max) return `${spec.label} must be at most ${spec.max}`
  return null
}

/** Copy-on-write write of `value` at `path` inside `node` (a `{type:'num'}` leaf, or an
 *  offset node's bare `value`, the two shapes a locator ends at). */
/** Do two trees hold the same literal at `path` (both a plain number there, equal)? */
function sameLiteralAt(a, b, path) {
  const x = literalValueOf(readAt(a, path))
  const y = literalValueOf(readAt(b, path))
  return x !== null && y !== null && Object.is(x, y)
}

function writeLiteral(node, path, value) {
  const [head, ...rest] = path
  if (rest.length === 0) {
    if (typeof head === 'number') {
      const copy = node.slice()
      copy[head] = { ...copy[head], value }
      return copy
    }
    if (node && node.type === 'offset' && head === 'value' && typeof node.value === 'number') return { ...node, value }
    return { ...node, [head]: { ...node[head], value } }
  }
  if (typeof head === 'number') {
    const copy = node.slice()
    copy[head] = writeLiteral(node[head], rest, value)
    return copy
  }
  return { ...node, [head]: writeLiteral(node[head], rest, value) }
}

const specialMemo = new WeakMap()

/**
 * The definition one instance computes: `def` with every parameter setting the instance
 * moved off its default written into its literals. Returns `def` itself when nothing
 * moved, a memoised copy otherwise, or `{refused: [sentence]}` for a value the door
 * would refuse.
 */
export function specializeParams(def, inputs) {
  const specs = paramInputSpecs(def)
  if (!specs.length || !isObj(inputs)) return def
  const moved = []
  for (const spec of specs) {
    if (!Object.prototype.hasOwnProperty.call(inputs, spec.key)) continue
    const v = inputs[spec.key]
    if (v === undefined || Object.is(v, spec.default)) continue
    const why = paramValueRefusal(spec, v)
    if (why) return { refused: why }
    moved.push([spec, v])
  }
  if (!moved.length) return def
  const sig = moved.map(([s, v]) => `${s.key}=${v}`).join('|')
  let byDef = specialMemo.get(def)
  if (!byDef) { byDef = new Map(); specialMemo.set(def, byDef) }
  const hit = byDef.get(sig)
  if (hit) return hit
  const compute = def.compute
  let ast = compute.ast
  const trees = Array.isArray(compute.trees) ? compute.trees.slice()
    : (isObj(compute.trees) ? { ...compute.trees } : compute.trees)
  // ⭐⭐ A NULL `treeIndex` NAMES THE SCAN PLOT'S TREE (`graphDocument.tagFromManifest` reads it so), and a
  // multi-tree document RUNS that plot from `trees[scanPlot]`, not from `ast`. Every saved Pine copy reads
  // back as a shared graph whose hydration (`hydrateGraphDocument`) writes the scan plot's locators with
  // `treeIndex: null`, so writing them into `ast` alone left the plot at the author's literal: a moved
  // setting did nothing to the first plot while the run half took it, and the column rail refused the run
  // (Fred RS's "Approximate Value of Comparative Symbol", found by the 10-member sweep, 2026-11-18). The
  // scan plot's tree is written too wherever it holds the same literal at that path (`sameLiteralAt`), so a
  // document whose `ast` is some other tree is never written blind.
  const scan = typeof compute.scanPlot === 'string' && isObj(trees) && trees[compute.scanPlot] !== undefined
    ? compute.scanPlot : null
  for (const [spec, v] of moved) {
    for (const loc of compute.paramManifest[spec.fromParam].locators) {
      const path = Array.isArray(loc.astPath) ? loc.astPath : []
      if (loc.treeIndex === null || loc.treeIndex === undefined) {
        if (scan !== null && sameLiteralAt(trees[scan], ast, path)) trees[scan] = writeLiteral(trees[scan], path, v)
        ast = writeLiteral(ast, path, v)
      } else trees[loc.treeIndex] = writeLiteral(trees[loc.treeIndex], path, v)
    }
  }
  const out = { ...def, compute: { ...compute, ast, ...(trees ? { trees } : {}) } }
  // non-enumerable: which instance values this copy was specialised for (diagnostics)
  Object.defineProperty(out, 'paramValues', { value: Object.fromEntries(moved.map(([s, v]) => [s.key, v])), enumerable: false })
  // non-enumerable: the stored document this copy specialises. A digest the door wrote over the stored
  // trees (the run half's program stamp, `runHalfProgram.js`) is checked against THIS, never the copy.
  Object.defineProperty(out, 'specializedFrom', { value: def, enumerable: false })
  if (byDef.size > 32) byDef.clear()
  byDef.set(sig, out)
  return out
}
