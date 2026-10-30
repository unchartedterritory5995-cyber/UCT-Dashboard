// app/src/components/chart/builder/legacyReadingPin.js
//
// ⭐⭐ P0-1 FOLLOW-UP (owner ruling 2026-10-30) — AN ORDINARY SAVE NEVER CONVERTS
// A LEGACY TC2000 READING.
//
// A definition saved before the 2026-10-30 reader fix stores the tree the old
// reader built (`STOC` fed close/high/low, `ATR` Wilder-smoothed). Reopening it
// re-parses the source with TODAY's reader, so without this module the next Save
// would silently store the corrected tree — and every alert and scan on it would
// start firing on different numbers. The owner ruled that conversion is an
// explicit act with a warning, never a side effect of Save.
//
// So: a row whose source text is EXACTLY a source the stored definition ran on a
// legacy reading keeps the stored tree. Editing the formula text is a different
// formula and gets today's reading — but `legacyReadingsLost` names that case so
// the save asks first.

import { astHash } from '../engine/ast/parse'
import { legacyReadingOf } from '../engine/ast/pcf'

/** `Map(sourceText -> storedTree)` for every stored tree of `prior` that is a
 *  legacy reading of its own source. Empty for every other definition. */
export function legacyTreesOf(prior) {
  const out = new Map()
  const compute = prior && prior.compute
  if (!compute || compute.kind !== 'ast') return out
  const take = (source, tree) => {
    if (typeof source !== 'string' || !tree) return
    let h
    try { h = astHash(tree) } catch { return }
    if (legacyReadingOf(source, h, astHash)) out.set(source, tree)
  }
  take(compute.source, compute.ast)
  if (compute.trees && compute.sources) {
    for (const k of Object.keys(compute.sources)) take(compute.sources[k], compute.trees[k])
  }
  return out
}

/** One evaluated row (`{source, ast, ...}`) with its tree pinned to the stored
 *  legacy one when its source is unchanged. Identity otherwise. */
export function pinRow(row, pins) {
  if (!row || !pins || !pins.size || typeof row.source !== 'string') return row
  const tree = pins.get(row.source)
  return tree ? { ...row, ast: tree } : row
}

/** The legacy sources `prior` ran that `doc` no longer runs on that reading —
 *  the formulas a save would convert. Empty when nothing would change. */
export function legacyReadingsLost(prior, doc) {
  const before = legacyTreesOf(prior)
  if (!before.size) return []
  const after = legacyTreesOf(doc)
  return [...before.keys()].filter((src) => !after.has(src))
}
