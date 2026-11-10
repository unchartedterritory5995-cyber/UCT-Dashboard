// app/src/components/chart/engine/paramLiteral.js
//
// ─── THE PARAMETER LOCATOR READ, A LEAF ─────────────────────────────────────────
//
// `compute.paramManifest` names, per member parameter, the literal nodes it was
// folded into (`{treeIndex, astPath}`). These are the one reader of those nodes —
// moved here from `builder/paramEdit.js` (DIV-4) so the registry can ask the same
// question (`nativeRegistry.js::runtimeColoursAtDefaults`: is every folded
// parameter still at the author's default?) without importing the builder.
// `paramEdit.js` imports them; `param_manifest.py::_walk` / `_literal_value` are
// their server mirrors. Imports nothing.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function getTree(definition, treeIndex) {
  const compute = definition.compute || {}
  return treeIndex === null ? compute.ast : (compute.trees || {})[treeIndex]
}

/** Pure JSON read (never a parser) at an astPath — mirrors `param_manifest
 *  .py::_walk` exactly, key for key, so the two independently-written
 *  readers agree on what "args, then index 1" means by construction.
 *  Returns `undefined` if the path does not resolve. */
export function readAt(node, path) {
  let cur = node
  for (const step of path) {
    if (typeof step === 'number') {
      if (!Array.isArray(cur) || step < 0 || step >= cur.length) return undefined
      cur = cur[step]
    } else {
      if (!isPlainObject(cur)) return undefined
      cur = cur[step]
    }
  }
  return cur
}

/** A resolved node's value IFF it is a plain numeric literal — mirrors
 *  `param_manifest.py::_literal_value` exactly (both shapes: a wrapped
 *  `{type:'num', value}` node, or the offset-node bare-number shape, kept
 *  here for parity even though `pineParamManifest.js` never emits a locator
 *  ending there today — see `paramEdit.js`'s own header on that gap). */
export function literalValueOf(node) {
  let v
  if (isPlainObject(node) && node.type === 'num') v = node.value
  else if (typeof node === 'number') v = node
  else return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

/** ⭐ DIV-4 — is every parameter of `compute.paramManifest` still at its author's
 *  default, read at every one of its locators? A locator that does not resolve, or
 *  that is no longer a plain number, is NOT at the default (the answer must be a
 *  yes that can be proved). No manifest: yes. */
export function manifestAtDefaults(definition) {
  const manifest = (definition && definition.compute && definition.compute.paramManifest) || {}
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry.default !== 'number') return false
    for (const loc of (Array.isArray(entry.locators) ? entry.locators : [])) {
      const tree = getTree(definition, loc.treeIndex === undefined ? null : loc.treeIndex)
      const node = tree === undefined ? undefined : readAt(tree, loc.astPath || [])
      const v = literalValueOf(node)
      if (v === null || !Object.is(v, entry.default)) return false
    }
  }
  return true
}
