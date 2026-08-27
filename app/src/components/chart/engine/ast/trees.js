// app/src/components/chart/engine/ast/trees.js
//
// ─── THE MULTI-TREE HALF OF A DEFINITION'S IDENTITY ─────────────────────────
// `compute.fn` stays `astHash(compute.ast)` — the SCAN tree — so no existing
// hash moves (spec §5.1, contract "one object, one hash"). `treesHash` is the
// ADDITIVE identity a multi-plot document carries for change detection and the
// `compute.rev` migration: one string over every plot's own astHash, keys sorted.
//
// ⛔ WHY IT IS NOT `astHash([[key, tree], …])`: `astHash` asserts a canonical
// NODE (four shapes, exact keys) and a pair list is not one; hashing the list
// would need a second `stableStringify`, which `parse.js` keeps private on
// purpose. So the map is hashed THROUGH `astHash`: each tree's hash is that
// tree's canonical form, and the sorted `"key":hash` pairs are the canonical
// form of the map. The Python lane (W1b.8, `user_definitions.trees_hash`) MUST
// reproduce it byte for byte, and `tests/fixtures/ast/multi_tree_parity.json`
// (W1b.7) is the ONE pinned string both lanes are held to. Two facts that
// mirror needs: each pair carries `astHash`'s full `'sha256:<hex>'` value (the
// prefix is INSIDE the hashed text), and KEY_RE keeps keys ASCII, so the JS
// sort and Python's `sorted()` agree without a collation rule.
// ⛔ `KEY_RE` IS IMPORTED, NEVER RETYPED — the one input/plot/tree key grammar,
// exported from `parse.js` beside `LOOKBACK_RE`. This file held its own copy for
// one commit (W1b.1) and `defSchema.js` held another; `defSchema.test.js` now
// holds both modules to the one export.
import { astHash, sha256Hex, KEY_RE } from './parse'
import { REPAINT_MODES } from './lint'
import { FRESHNESS_MODES } from './freshness'

/** @returns {string[]} the plot keys, SORTED — the order every consumer must use.
 *
 *  Refusals are labelled by FIELD PATH (`compute.trees`), not by this function's
 *  name: `defSchema.validateTrees` pushes them verbatim, and a member reads where
 *  to look rather than which helper looked. */
export function assertTrees(trees) {
  if (!trees || typeof trees !== 'object' || Array.isArray(trees)) {
    throw new Error(
      `compute.trees: expected an object of plotKey → canonical tree, got ${
        trees === null ? 'null' : Array.isArray(trees) ? 'an array' : typeof trees}`)
  }
  const keys = Object.keys(trees).sort()
  if (!keys.length) throw new Error('compute.trees: an empty trees map names no plot')
  for (const k of keys) {
    if (!KEY_RE.test(k)) throw new Error(`compute.trees: ${JSON.stringify(k)} is not a legal plot key (${KEY_RE})`)
  }
  return keys
}

/** `'sha256:<64 hex>'` over `"<key>":<astHash(tree)>` pairs, keys sorted, comma-joined. */
export function treesHash(trees) {
  const keys = assertTrees(trees)
  const pairs = keys.map((k) => {
    let h
    try { h = astHash(trees[k]) } catch (err) {
      throw new Error(`compute.trees.${k}: ${err && err.message ? err.message : String(err)}`)
    }
    return `${JSON.stringify(k)}:${h}`
  })
  return `sha256:${sha256Hex(pairs.join(','))}`
}

// ─── the badge aggregators ───────────────────────────────────────────────────
// ⛔ ONE PLACE. `buildDefinition` writes the badge and `validateAstLane`
// re-measures it in both directions; if the two aggregated differently a
// multi-plot document could never be saved, or could be saved under a badge
// the gate would not have chosen. Unknown values fail CLOSED to the worst —
// and so does an EMPTY list: no tree makes no promise.
//
// ⛔ THE ORDERS ARE IMPORTED, NEVER RETYPED. `lint.js` declares `REPAINT_MODES`
// and `freshness.js` declares `FRESHNESS_MODES`, each best-first / worst-last
// (`freshness.js`: "unknown — FAIL-CLOSED = the STALEST claim"). A copy here
// would be a second authority over one vocabulary: the day either lane grows a
// mode, this file would call it unrecognised and brand a clean definition with
// the worst badge. `trees.test.js` round-trips every emittable mode as itself.

function worstOf(modes, order) {
  const worst = order.length - 1
  if (!Array.isArray(modes) || !modes.length) return order[worst]
  let idx = 0
  for (const m of modes) {
    const i = order.indexOf(m)
    idx = Math.max(idx, i === -1 ? worst : i)
  }
  return order[idx]
}
export function worstRepaint(modes) { return worstOf(modes, REPAINT_MODES) }
export function stalestFreshness(modes) { return worstOf(modes, FRESHNESS_MODES) }
