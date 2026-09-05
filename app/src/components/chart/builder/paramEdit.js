// app/src/components/chart/builder/paramEdit.js
//
// ─── APPLYING A MEMBER'S PARAMETER EDIT (TRACK F, DEC-006) ──────────────────
//
// ⭐⭐ NO PINE MACHINERY RUNS HERE, EVER. By the time a saved definition
// exists, Pine text is already gone — the owner's own standing rule ("do not
// persist raw Pine source") and this codebase's Phase Zero boundary both
// require it. Editing a parameter therefore cannot re-run `translatePine`;
// it operates purely on the ALREADY-SAVED `compute.ast`/`compute.trees`,
// using the SAME `{treeIndex, astPath}` locators `param_manifest.py`
// reconciles server-side. This is "the existing client-side parser/compiler
// path" the owner's FINAL AUTHORITY MODEL names: `printFormula` (AST→text,
// already used to build `compute.source` at import time) and `parseFormula`
// + `astHash` (text→AST, the SAME two primitives `pine.js`'s own internal
// `verifyRoundTrip` already uses to prove its OWN printed output reads back)
// — never a second parser, never a bespoke `let`-substitution convention.
//
// ⛔ MUTATE THE TREE FIRST, RE-DERIVE TEXT SECOND, NEVER THE REVERSE. There
// is no special `let __uct_param_1 = 14` source syntax anywhere (`param_
// manifest.py`'s own module docstring records why: that was ADR V2's
// original idea and it does not survive contact with how this mechanism
// actually keeps `_no_offset`/`windowLiteral` satisfied). `compute.source`
// for a parameterized definition is ordinary printed UCT-DSL text, nothing
// more — so an edit replaces the literal at each locator's `astPath`
// directly, then calls `printFormula` to keep the text honest about what
// the tree now says.
//
// ⛔⛔ EVERY MUTATION IS VERIFIED ROUND-TRIP BEFORE IT IS ACCEPTED — print,
// re-parse, compare `astHash`. A hand-spliced tree that doesn't read back to
// itself (a float-formatting edge case, a normalization this printer/parser
// pair disagrees on) is refused HERE, client-side, before it ever reaches a
// save — never silently shipped as a definition whose own printed source
// lies about its tree.
//
// ⚠️ KNOWN V1 LIMITATION, DISCLOSED: an `input.int` used ONLY as a bar
// DISPLACEMENT index (`close[n]` where `n = input.int(10)`) is not
// supported — an offset node's own literal lives at a BARE NUMBER `value`
// field, not a `{type:'num'}` node, and `pine.js`'s offset-building code
// (`foldDisplacement`) does not carry a parameter tag onto that bare
// primitive today (a JS number cannot hold a non-enumerable property; only
// the object wrapping it could, and nothing wraps it). `param_manifest.py`'s
// server-side reconciliation already handles this locator SHAPE correctly
// (`test_4_offset_window_case...`, proven against a hand-built fixture) —
// the gap is translator-side production of such a locator, not enforcement.
// Scoped out of v1 because the real RISK-013 fixture never exercises it and
// the owner's authorization does not name it. A future pass would need
// `foldDisplacement` to tag the OFFSET NODE OBJECT itself and this module to
// special-case an astPath whose last step is the literal `'value'` key
// against a bare number rather than a `{type:'num'}` object.

import { printFormula } from '../engine/ast/pine.js'
import { parseFormula, astHash } from '../engine/ast/parse.js'
import { treesHash } from '../engine/ast/trees.js'

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function getTree(definition, treeIndex) {
  const compute = definition.compute || {}
  return treeIndex === null ? compute.ast : (compute.trees || {})[treeIndex]
}

/** Pure JSON read (never a parser) at an astPath — mirrors `param_manifest
 *  .py::_walk` exactly, key for key, so the two independently-written
 *  readers agree on what "args, then index 1" means by construction.
 *  Returns `undefined` if the path does not resolve. */
function readAt(node, path) {
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
function literalValueOf(node) {
  let v
  if (isPlainObject(node) && node.type === 'num') v = node.value
  else if (typeof node === 'number') v = node
  else return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

export const ATTACHED = 'attached'
export const DETACHED = 'detached'
export const PARTIALLY_DETACHED = 'partially_detached'
export const CONFLICTED = 'conflicted'
export const NON_LITERAL = 'non_literal'

/**
 * The read-only, always-fresh-derived state for every parameter in
 * `definition.compute.paramManifest` — a JS mirror of `param_manifest.py::
 * reconcile()`, kept in lockstep by `paramEdit.reconcile.test.js`'s
 * parity fixtures. Used for DISPLAY ONLY: `save()` computes and stores the
 * authoritative `compute.paramState` server-side (ADR V2.2 S3(B) — current
 * value has exactly one authority, `compute.ast`/`compute.trees`, and is
 * never trusted from a client-cached copy for anything that matters). This
 * lets a definition BEFORE its first save (no `compute.paramState` from the
 * server yet) still render correctly.
 *
 * @returns {object} `{ [paramId]: { state, value, reason } }`
 */
export function reconcileParams(definition) {
  const manifest = (definition.compute && definition.compute.paramManifest) || {}
  const state = {}
  for (const [id, entry] of Object.entries(manifest)) {
    const locators = Array.isArray(entry.locators) ? entry.locators : []
    const values = []
    let anyDetached = false
    let anyNonLiteral = false
    for (const loc of locators) {
      const tree = getTree(definition, loc.treeIndex)
      const node = tree === undefined ? undefined : readAt(tree, loc.astPath || [])
      if (node === undefined) { anyDetached = true; continue }
      const v = literalValueOf(node)
      if (v === null) { anyNonLiteral = true; continue }
      values.push(v)
    }
    const n = locators.length
    if (n === 0) {
      state[id] = { state: DETACHED, value: null, reason: 'this parameter declares no binding locations' }
    } else if (anyNonLiteral) {
      state[id] = {
        state: NON_LITERAL, value: null,
        reason: "this input's binding is no longer a plain number and can't be shown as a slider",
      }
    } else if (values.length === 0) {
      state[id] = {
        state: DETACHED, value: null,
        reason: "this control's underlying binding was removed or renamed",
      }
    } else if (anyDetached) {
      state[id] = {
        state: PARTIALLY_DETACHED, value: null,
        reason: `only ${values.length} of ${n} of this control's bindings still exist — `
          + 'it has been disabled rather than shown partially working',
      }
    } else if (new Set(values).size > 1) {
      state[id] = {
        state: CONFLICTED, value: null,
        reason: `this control's bindings disagree (${[...new Set(values)].sort((a, b) => a - b).join(', ')}) `
          + 'across the trees it appears in — edit each tree directly, or use the control once it\'s reconciled',
      }
    } else {
      state[id] = { state: ATTACHED, value: values[0], reason: null }
    }
  }
  return state
}

/** Structural, copy-on-write replace of the LEAF the astPath's last step
 *  names — the whole node at that position becomes `{ ...oldNode, value }`,
 *  never a bare value swapped into an arbitrary spot. Every ancestor along
 *  the path is shallow-copied so the ORIGINAL tree (still referenced
 *  elsewhere — e.g. another locator's read, or the caller's own retry on
 *  failure) is never mutated in place. */
function replaceLiteralAt(node, path, value) {
  if (path.length === 0) {
    throw new Error('paramEdit: an astPath must not be empty')
  }
  const [head, ...rest] = path
  if (rest.length === 0) {
    if (typeof head === 'number') {
      if (!Array.isArray(node)) {
        throw new Error(`paramEdit: astPath expects an array at index ${head}, got ${typeof node}`)
      }
      const copy = node.slice()
      const leaf = copy[head]
      if (!isPlainObject(leaf) || leaf.type !== 'num') {
        throw new Error(`paramEdit: astPath's final position is not a {type:'num'} node (got ${JSON.stringify(leaf)})`)
      }
      copy[head] = { ...leaf, value }
      return copy
    }
    if (!isPlainObject(node)) {
      throw new Error(`paramEdit: astPath expects an object at key ${JSON.stringify(head)}, got ${typeof node}`)
    }
    const leaf = node[head]
    if (!isPlainObject(leaf) || leaf.type !== 'num') {
      throw new Error(`paramEdit: astPath's final position is not a {type:'num'} node (got ${JSON.stringify(leaf)})`)
    }
    return { ...node, [head]: { ...leaf, value } }
  }
  if (typeof head === 'number') {
    if (!Array.isArray(node)) {
      throw new Error(`paramEdit: astPath expects an array at index ${head}, got ${typeof node}`)
    }
    const copy = node.slice()
    copy[head] = replaceLiteralAt(node[head], rest, value)
    return copy
  }
  if (!isPlainObject(node)) {
    throw new Error(`paramEdit: astPath expects an object at key ${JSON.stringify(head)}, got ${typeof node}`)
  }
  return { ...node, [head]: replaceLiteralAt(node[head], rest, value) }
}

/** Print `ast`, re-parse the printed text, and confirm the two are the SAME
 *  tree by `astHash` — the exact two-primitive check `pine.js`'s own
 *  (unexported) `verifyRoundTrip` performs internally on the translator's
 *  own output, reused here at the builder layer for a hand-mutated tree.
 *  @returns {{ok:true, formula:string} | {ok:false, error:string}} */
function printAndVerify(ast) {
  let formula
  try {
    formula = printFormula(ast)
  } catch (err) {
    return { ok: false, error: `paramEdit: could not print the mutated tree (${err && err.message ? err.message : err})` }
  }
  const reparsed = parseFormula(formula)
  if (!reparsed.ok) {
    return { ok: false, error: `paramEdit: the mutated tree's own printed text does not read back (${reparsed.error})` }
  }
  let a
  let b
  try {
    a = astHash(reparsed.ast)
    b = astHash(ast)
  } catch (err) {
    return { ok: false, error: `paramEdit: round-trip hash check failed (${err && err.message ? err.message : err})` }
  }
  if (a !== b) {
    return { ok: false, error: 'paramEdit: the mutated tree does not round-trip to itself through print+parse' }
  }
  return { ok: true, formula }
}

/** [reject-not-clamp] the SAME bounds `param_manifest.py::_validate_bounds`
 *  enforces server-side, checked client-side FIRST so a member gets an
 *  immediate, specific message rather than a round-trip to find out their
 *  save was refused. The server remains the one true authority — this is a
 *  courtesy, never a substitute for its own check. */
function validateValue(entry, value) {
  if (entry.type === 'int') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return `must be a whole number, got ${JSON.stringify(value)}`
    }
  } else if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `must be a number, got ${JSON.stringify(value)}`
  }
  if (Array.isArray(entry.options)) {
    if (!entry.options.includes(value)) {
      return `${value} is not one of the declared options ${JSON.stringify(entry.options)}`
    }
    return null
  }
  if (entry.min != null && value < entry.min) return `must be >= ${entry.min}, got ${value}`
  if (entry.max != null && value > entry.max) return `must be <= ${entry.max}, got ${value}`
  return null
}

/**
 * Apply a member's new value for ONE logical parameter, atomically across
 * every one of its locators (ADR V2.2 §1/§2 — a UI edit is one atomic
 * operation; if any locator's tree fails to round-trip, NOTHING in the
 * returned definition changes).
 *
 * @param {object} definition a full saved-definition document (the same
 *        shape `PUT /{def_id}` submits) carrying `compute.paramManifest`.
 * @param {string} paramId the logical parameter id (`__uct_param_<n>`).
 * @param {number} newValue the member's requested value.
 * @returns {{ok:true, definition:object} | {ok:false, error:string}}
 *        On failure, `definition` is NEVER partially applied — the caller's
 *        original object is untouched (every helper above is copy-on-write).
 */
export function applyParamEdit(definition, paramId, newValue) {
  const manifest = (definition.compute && definition.compute.paramManifest) || {}
  const entry = manifest[paramId]
  if (!entry) {
    return { ok: false, error: `paramEdit: no such parameter on this definition: ${paramId}` }
  }
  const boundsError = validateValue(entry, newValue)
  if (boundsError) {
    return { ok: false, error: `paramEdit: ${entry.title || paramId} ${boundsError}` }
  }
  const locators = Array.isArray(entry.locators) ? entry.locators : []
  if (locators.length === 0) {
    return { ok: false, error: `paramEdit: ${entry.title || paramId} has no binding locations to update` }
  }

  // ⛔ ACCUMULATE INTO A SEPARATE MAP FIRST, apply to `definition` only after
  // EVERY locator's round-trip has verified — the atomicity ADR V2.2 §2
  // requires ("if re-translating or re-analyzing ANY affected tree fails...
  // the entire parameter change is refused and NOTHING saves").
  const updatedByTreeIndex = new Map()
  const updatedFormulaByTreeIndex = new Map()
  for (const loc of locators) {
    const tree = getTree(definition, loc.treeIndex)
    if (tree === undefined) {
      // ⛔ A DETACHED LOCATOR IS NOT AN ERROR HERE — `param_manifest.py`'s own
      // `reconcile()` already marks the WHOLE parameter `partially_detached`/
      // `detached` server-side when a locator fails to resolve, and this
      // function is never called for a non-`attached` parameter by the UI
      // (see `ParamControls.jsx`) — but defensively, skipping rather than
      // throwing keeps this function correct even if called on a stale
      // manifest snapshot from before a locator vanished.
      continue
    }
    // ⛔ A MALFORMED LOCATOR REFUSES THE WHOLE EDIT, IT NEVER THROWS PAST
    // THIS FUNCTION. `replaceLiteralAt` raises when an astPath's final
    // position is not a plain literal — a corrupted or hand-tampered
    // manifest entry, never a shape the translator itself produces — and
    // the atomicity contract above means one bad locator must fail the
    // batch exactly like a bad round-trip does, not crash the caller.
    let mutated
    try {
      mutated = replaceLiteralAt(tree, loc.astPath, newValue)
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
    const verified = printAndVerify(mutated)
    if (!verified.ok) return verified
    updatedByTreeIndex.set(loc.treeIndex, mutated)
    updatedFormulaByTreeIndex.set(loc.treeIndex, verified.formula)
  }
  if (updatedByTreeIndex.size === 0) {
    return { ok: false, error: `paramEdit: ${entry.title || paramId} — every locator is detached; nothing to update` }
  }

  const compute = { ...definition.compute }
  const hasMultiTree = isPlainObject(compute.trees)
  if (hasMultiTree) {
    const trees = { ...compute.trees }
    const sources = { ...(compute.sources || {}) }
    for (const [treeIndex, mutated] of updatedByTreeIndex) {
      trees[treeIndex] = mutated
      sources[treeIndex] = updatedFormulaByTreeIndex.get(treeIndex)
      if (compute.scanPlot === treeIndex) {
        compute.ast = mutated
        compute.source = updatedFormulaByTreeIndex.get(treeIndex)
      }
    }
    compute.trees = trees
    compute.sources = sources
    compute.treesHash = treesHash(trees)
  } else {
    // Single-tree v1 shape — every locator's `treeIndex` is `null` by
    // construction (`pineParamManifest.js` never emits any other key when
    // the caller passes one kept tree with `treeIndex: null`).
    const mutated = updatedByTreeIndex.get(null)
    compute.ast = mutated
    compute.source = updatedFormulaByTreeIndex.get(null)
  }

  return { ok: true, definition: { ...definition, compute } }
}
