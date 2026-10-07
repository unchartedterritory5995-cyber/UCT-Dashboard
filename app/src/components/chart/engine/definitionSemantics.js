// app/src/components/chart/engine/definitionSemantics.js
//
// ⭐⭐ P0G — A DOCUMENT'S DEFINITION SEMANTICS, READ IN ONE PLACE (owner decisions
// A + C, 2026-10-05).
//
// `meta.semantics: 2` is stamped by the STORE (`api/services/user_definitions.py
// ::decide_semantics`) on a NEW native / PCF / thinkScript save — a create, or an
// edit whose maths moved — and never on a Pine translation. Under it both lanes
// evaluate with `opts.semantics === 2` (`interpret.js::semanticsV2`):
//   A. a comparison with an unknown operand is UNKNOWN (not 0);
//   C. `rsi` / `atr` / `adx` / `plusDI` / `minusDI` HOLD across a hole instead of
//      restarting after it (`interpret.js::FN_V2`).
// Absent means 1 — every row saved before this, every Pine translation, every
// shipped document — and 1 is the evaluation this engine always ran.
//
// ⛔ THE BROWSER NEVER DECIDES IT FOR A STORED ROW. `semanticsOptsFor` reads what
// the store wrote; `stampSemantics` exists only so a builder PREVIEW draws under
// the semantics the store's rule will give the save (the server re-decides and a
// client value is discarded there); `withStoredSemantics` writes the store's own
// answer (the save response's `semantics`) onto the copy the builder installs.
// Python twin: `ast_interpret.py::semantics_for` / `semantics_opts_for`.

import { SEMANTICS_UNKNOWN_PROPAGATES } from './ast/interpret.js'
import { astHash } from './ast/parse.js'
import { treesHash } from './ast/trees.js'

export { SEMANTICS_UNKNOWN_PROPAGATES }
export const LEGACY_SEMANTICS = 1
export const SEMANTICS_META_KEY = 'semantics'
/** `nativeRegistry.PINE_RECURRENCE_ORIGIN` — restated, not imported, so this
 *  module stays below the registry (a rail asserts the two agree). */
export const PINE_ORIGIN = 'pine'

/** Is this document a Pine translation (`meta.recurrenceOrigin === 'pine'`)? */
export function isPineOrigin(def) {
  return !!(def && def.meta && def.meta.recurrenceOrigin === PINE_ORIGIN)
}

/** ⭐ PHASE 4 — Pine-translated maths by ANY door: a `recurrenceOrigin`
 *  translation, or a Builder "Apply" import stamped `meta.importedFrom.dialect`.
 *  Mirrors `user_definitions.py::is_pine_import`; used ONLY by the preview stamp
 *  below (it does not change how a document evaluates). */
export function isPineImport(def) {
  if (isPineOrigin(def)) return true
  const imp = def && def.meta && def.meta.importedFrom
  return !!(imp && typeof imp === 'object' && String(imp.dialect || '').toLowerCase() === PINE_ORIGIN)
}

/** 2 only for a non-Pine document carrying exactly `meta.semantics === 2`. */
export function semanticsOf(def) {
  if (!def || !def.meta || isPineOrigin(def)) return LEGACY_SEMANTICS
  return def.meta[SEMANTICS_META_KEY] === SEMANTICS_UNKNOWN_PROPAGATES
    ? SEMANTICS_UNKNOWN_PROPAGATES : LEGACY_SEMANTICS
}

/**
 * ⭐⭐ THE RESULT IDENTITY (owner decision A, 2026-10-06) — the key every shared /
 * durable result of a definition is filed under on the server: the scan tree's
 * hash, `~s2`-suffixed when the definition is semantics 2. Semantics 1 is the
 * bare hash (every pre-existing key unchanged). Python twin:
 * `user_definitions.py::result_identity`; both read
 * `tests/fixtures/ast/semantics_result_identity.json`.
 * ⛔ A browser asks the server for results BY this key; it never writes one.
 */
export const SEMANTICS_IDENTITY_SUFFIX = '~s2'
export function semanticIdentity(treeHash, semantics) {
  return semantics === SEMANTICS_UNKNOWN_PROPAGATES ? `${treeHash}${SEMANTICS_IDENTITY_SUFFIX}` : treeHash
}
export function resultIdentity(def) {
  const tree = def && def.compute ? def.compute.ast : null
  if (!tree) return null
  return semanticIdentity(astHash(tree), semanticsOf(def))
}

/** The `interpret` opts that carry this document's semantics — `{}` for 1. */
export function semanticsOptsFor(def) {
  return semanticsOf(def) === SEMANTICS_UNKNOWN_PROPAGATES
    ? { semantics: SEMANTICS_UNKNOWN_PROPAGATES } : {}
}

function withoutStamp(def) {
  if (!def || !def.meta || !(SEMANTICS_META_KEY in def.meta)) return def
  const { [SEMANTICS_META_KEY]: _drop, ...meta } = def.meta
  return { ...def, meta }
}

function withStamp(def, value) {
  return { ...def, meta: { ...(def.meta || {}), [SEMANTICS_META_KEY]: value } }
}

/** The two identities the store's `rev_bumped` asks (`ast_hash` of the scan
 *  tree, `treesHash` of the plots), or null when either cannot be computed. */
function mathsIdentity(def) {
  try {
    const compute = (def && def.compute) || {}
    const trees = compute.trees ? treesHash(compute.trees) : ''
    return `${astHash(compute.ast)}|${trees}`
  } catch {
    return null
  }
}

/** The store's rule, for a PREVIEW: `prior` is the stored document being edited
 *  (null for a create), `dialect` the import dialect this draft's maths came
 *  from. Mirrors `decide_semantics`; the server's answer is the one that counts. */
export function stampSemantics(def, { prior = null, dialect = null } = {}) {
  if (!def) return def
  const bare = withoutStamp(def)
  if (isPineOrigin(bare)) return bare
  // ⭐ PHASE 4 — the store keeps Pine semantics for an Apply import and for any
  // edit of a stored Pine import (`decide_semantics`); the preview draws the same.
  if (isPineImport(bare) || (prior && isPineImport(prior))) return bare
  const priorId = prior ? mathsIdentity(prior) : null
  const unchanged = prior && priorId !== null && priorId === mathsIdentity(bare)
  if (unchanged) {
    return semanticsOf(prior) === SEMANTICS_UNKNOWN_PROPAGATES
      ? withStamp(bare, SEMANTICS_UNKNOWN_PROPAGATES) : bare
  }
  if (typeof dialect === 'string' && dialect.trim().toLowerCase() === 'pine') return bare
  return withStamp(bare, SEMANTICS_UNKNOWN_PROPAGATES)
}

/** The copy the builder installs after a save, carrying the STORE's answer
 *  (`row.semantics`). A response without one leaves the stamp off (semantics 1),
 *  which is what every server before this stored. */
export function withStoredSemantics(def, row) {
  const bare = withoutStamp(def)
  return row && row.semantics === SEMANTICS_UNKNOWN_PROPAGATES && !isPineOrigin(bare)
    ? withStamp(bare, SEMANTICS_UNKNOWN_PROPAGATES) : bare
}
