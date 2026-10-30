// app/src/components/chart/engine/memberDocumentMigration.js
//
// ─── ⭐⭐ A SAVED MEMBER DOCUMENT GETS TODAY'S BEHAVIOUR ON LOAD ─────────────
//
// Applied where every document enters a chart — `nativeRegistry.validateUserDefinitions`
// — as a PURE, DETERMINISTIC, IDEMPOTENT repair of the document in hand (member data
// is never rewritten server-side). It repairs exactly one defect, the one a
// document's own bytes PROVE:
//
//   ⚰️ A STALE HANDLE. `applyParamEdit` used to rewrite the scan tree and leave
//   `compute.fn` at the UNEDITED tree's hash, which `defSchema` refuses — the edited
//   document could not install. The handle is set back to the hash of the tree the
//   document holds, ONLY for a param-edited `ast` document whose trees are otherwise
//   self-consistent (`treesHash`). A handle that disagrees for any other reason is
//   still refused, by `defSchema`.
//
// ⛔⛔ IT DOES NOT PLACE PARAMETERS IN CONDITION COLUMNS, AND CANNOT. Round 2 did, by
// matching call shape, and claimed constants the author hard-coded: in
// `len = input.int(21)` beside a colour rule's literal `ta.ema(close, 21)`, the 21 was
// given to `len`, so an edit rewrote the colour. A saved document does not carry
// the Pine source or the translator's tags, and the old door never moved a condition
// column, so in an old document:
//   • a column literal at the parameter's DEFAULT is byte-identical whether it came
//     from the parameter or was typed by the author — unprovable, skipped;
//   • a column literal at the CURRENT (edited, non-default) value can only have been
//     typed by the author — provably NOT the parameter, skipped.
// Nothing is provable, so nothing is claimed. A document gets today's placements when
// it is next built from its source through the door, which places only TAGGED
// literals (`memberPaneDefinition.noGuess.test.js`).
//
// ⛔ A document that needs nothing comes back as the SAME object, and the answer is
// memoised per document object (a pane rebuild calls this on every keystroke).

import { astHash } from './ast/parse.js'
import { treesHash } from './ast/trees.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function migrateStaleHandle(def) {
  const c = def.compute
  if (!c || c.kind !== 'ast' || !isObj(c.paramManifest) || typeof c.fn !== 'string' || !c.ast) return def
  let now
  try { now = astHash(c.ast) } catch { return def }
  if (now === c.fn) return def
  // ⛔ only a self-consistent document: its trees still hash to its `treesHash`
  if (isObj(c.trees)) {
    try { if (typeof c.treesHash === 'string' && treesHash(c.trees) !== c.treesHash) return def } catch { return def }
  }
  return { ...def, compute: { ...c, fn: now } }
}

const memo = new WeakMap()

/** One saved document → the same document with today's behaviour. Pure; memoised
 *  per document object (documents are treated as immutable everywhere they flow). */
export function migrateMemberDocument(def) {
  if (!isObj(def)) return def
  // ⭐ the cheap identity path: only a param-edited `ast` document can need a repair
  const c = def.compute
  if (!c || c.kind !== 'ast' || !isObj(c.paramManifest) || typeof c.fn !== 'string') return def
  const hit = memo.get(def)
  if (hit) return hit
  const out = migrateStaleHandle(def)
  memo.set(def, out)
  if (out !== def) memo.set(out, out)
  return out
}
